import { randomUUID } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'
import type { GuestBalanceChanged } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { signWebhookBody } from './webhook-signature'

/**
 * Исходящие события к кассе. docs/02, раздел 4.3.
 *
 * СОБЫТИЕ ВЫВОДИТСЯ ИЗ ЖУРНАЛА, А НЕ ПИШЕТСЯ РЯДОМ С НИМ. Это главное решение
 * файла. Отправить событие «после коммита» нельзя: между коммитом и отправкой
 * процесс может умереть, и касса навсегда останется с устаревшим балансом.
 * Писать доставку в транзакции журнала гарантию даёт, но требует, чтобы ядро
 * знало про кассу, — а журнал уже долговечен, и из него всё видно и так.
 *
 * Обратное неверно, и это нормально: событие может уйти дважды. Поэтому
 * у него есть `eventId`, по которому касса дедуплицирует у себя — ровно так же,
 * как мы дедуплицируем входящие. Гарантировать «ровно один раз» через сеть
 * нельзя в принципе; можно гарантировать «не меньше одного» и дать получателю
 * чем отличить повтор.
 */

/** Паузы перед повторами. docs/02, раздел 4.3: 1с, 5с, 30с, 5м, 30м. */
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000] as const

/** Сколько попыток всего. Ровно столько, сколько задержек в списке. */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length

/** Сколько событий берём за один проход. Больше — дольше держим соединение. */
const BATCH_SIZE = 20

/** Сколько ждём ответа кассы. Дольше — очередь встаёт из-за одного молчуна. */
const REQUEST_TIMEOUT_MS = 5_000

/** Операция журнала, о которой касса ещё не знает. Из функции поверх границ. */
interface AwaitingEntry {
  id: string
  tenantId: string
  guestId: string
  amount: number
  balanceAfter: number
  occurredAt: Date | null
  createdAt: Date
  targetUrl: string
}

/** Строка очереди в том виде, в каком её отдаёт функция поверх границы заведений. */
interface DueDelivery {
  id: string
  tenantId: string
  eventType: string
  payload: unknown
  targetUrl: string
  attempts: number
}

/** Как отправляется событие. Отдельным типом, чтобы тест не ходил в сеть. */
export interface WebhookSender {
  send: (input: {
    url: string
    body: string
    signature: string
    timestamp: number
  }) => Promise<{ ok: boolean; status: number }>
}

@Injectable()
export class WebhookOutboxService {
  private readonly logger = new Logger(WebhookOutboxService.name)

  /** Подменяется в тестах: сеть в тестах — источник мигания, а не проверки. */
  sender: WebhookSender = { send: httpSend }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Один проход: завести новые доставки и отправить всё, чему пора.
   *
   * Два шага подряд, а не один: между «увидели операцию» и «отправили»
   * лежит запись в базу, которая обязана пережить падение процесса.
   */
  async tick(
    now: Date = new Date(),
  ): Promise<{ queued: number; delivered: number; failed: number }> {
    const queued = await this.enqueuePending(now)
    const { delivered, failed } = await this.flush(now)

    return { queued, delivered, failed }
  }

  /**
   * Заводит доставки для операций, о которых касса ещё не знает.
   *
   * Источник — САМ ЖУРНАЛ, а не отдельная запись рядом с ним. Журнал
   * append-only и долговечен, поэтому «операция есть, а события нет» — это
   * состояние, из которого всегда можно доехать: следующий проход его увидит.
   * Писать доставку в транзакции журнала было бы мгновеннее, но потребовало бы,
   * чтобы ядро знало про кассу; такую зависимость потом не разорвать.
   *
   * Повторный проход по той же операции безопасен: `ledgerEntryId` уникален,
   * и вторая вставка упирается в базу, а не в удачу.
   *
   * `now` приходит снаружи по той же причине, что и в отправке: момент решения
   * обязан быть одним на весь проход.
   */
  async enqueuePending(now: Date = new Date()): Promise<number> {
    const rows = await this.prisma.$queryRaw<AwaitingEntry[]>`
      SELECT * FROM ledger_entries_awaiting_delivery(${BATCH_SIZE}::int, ${now}::timestamptz)
    `

    let created = 0

    for (const row of rows) {
      const payload: GuestBalanceChanged = {
        event: 'guest.balance_changed',
        eventId: randomUUID(),
        occurredAt: (row.occurredAt ?? row.createdAt).toISOString(),
        guestId: row.guestId,
        balance: row.balanceAfter,
        delta: row.amount,
      }

      try {
        await this.prisma.forTenant(row.tenantId, async (tx) => {
          await tx.webhookDelivery.create({
            data: {
              tenantId: row.tenantId,
              ledgerEntryId: row.id,
              eventType: payload.event,
              payload,
              targetUrl: row.targetUrl,
              // Момент ставим САМИ, а не полагаемся на часы базы.
              //
              // Иначе выходит гонка на миллисекундах: `tick` снимает время
              // до постановки в очередь, а `now()` базы срабатывает после —
              // и свежая доставка оказывается «в будущем» относительно того
              // же прохода. Она уходила бы всегда на проход позже, а тест
              // расписания повторов вообще не мог бы существовать.
              nextAttemptAt: now,
            },
          })
        })
        created += 1
      } catch {
        // Уникальный индекс: доставку успел завести соседний проход.
        // Это штатный исход гонки, а не сбой.
      }
    }

    return created
  }

  /**
   * Отправляет всё, чему пора уходить. Возвращает, сколько ушло и сколько нет.
   *
   * Ошибки наружу не выбрасывает: разгребатель очереди работает по таймеру,
   * и падать ему не на кого.
   */
  async flush(now: Date = new Date()): Promise<{ delivered: number; failed: number }> {
    // Момент передаётся В БАЗУ, а не берётся её часами: время решения обязано
    // быть одним. Иначе расписание повторов считается от одного момента,
    // а выборка идёт по другому — и сдвиг часов между процессом и базой
    // превращается в повторы не тогда, когда задумано.
    const due = await this.prisma.$queryRaw<DueDelivery[]>`
      SELECT * FROM webhook_deliveries_due(${BATCH_SIZE}::int, ${now}::timestamptz)
    `

    let delivered = 0
    let failed = 0

    for (const item of due) {
      const outcome = await this.deliver(item, now)

      if (outcome === 'DELIVERED') {
        delivered += 1
      } else if (outcome === 'FAILED') {
        failed += 1
      }
    }

    return { delivered, failed }
  }

  private async deliver(item: DueDelivery, now: Date): Promise<'DELIVERED' | 'RETRY' | 'FAILED'> {
    const body = JSON.stringify(item.payload)
    const timestamp = Math.floor(now.getTime() / 1000)

    const secret = await this.secretFor(item.tenantId)

    if (secret === null) {
      // Связь отозвали, пока событие ждало. Подписать нечем и слать некуда.
      await this.finish(item, 'FAILED', 'Связь с кассой отозвана')
      return 'FAILED'
    }

    let ok = false
    let detail = ''

    try {
      const response = await this.sender.send({
        url: item.targetUrl,
        body,
        // Подписываем ТЕМ ЖЕ способом, что проверяем входящие: одна функция
        // на оба направления — значит и ломаться будет в одном месте.
        signature: signWebhookBody(Buffer.from(body), secret, timestamp),
        timestamp,
      })

      ok = response.ok
      detail = `HTTP ${response.status}`
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error)
    }

    if (ok) {
      await this.finish(item, 'DELIVERED', null)
      return 'DELIVERED'
    }

    const attempts = item.attempts + 1

    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.finish(item, 'FAILED', detail)
      // Тело события не логируем: в нём идентификатор гостя и его баланс.
      this.logger.warn(`Событие ${item.id} не доставлено за ${attempts} попыток: ${detail}`)
      return 'FAILED'
    }

    const delay = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0

    await this.prisma.forTenant(item.tenantId, async (tx) => {
      await tx.webhookDelivery.updateMany({
        where: { id: item.id, tenantId: item.tenantId },
        data: {
          attempts,
          nextAttemptAt: new Date(now.getTime() + delay),
          lastError: detail.slice(0, 500),
        },
      })
    })

    return 'RETRY'
  }

  private async finish(
    item: DueDelivery,
    status: 'DELIVERED' | 'FAILED',
    error: string | null,
  ): Promise<void> {
    await this.prisma.forTenant(item.tenantId, async (tx) => {
      await tx.webhookDelivery.updateMany({
        where: { id: item.id, tenantId: item.tenantId },
        data: {
          status,
          attempts: { increment: 1 },
          ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          lastError: error === null ? null : error.slice(0, 500),
        },
      })
    })
  }

  private async secretFor(tenantId: string): Promise<string | null> {
    const link = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.posLink.findFirst({
        where: { tenantId, isActive: true, revokedAt: null },
        select: { webhookSecret: true },
      }),
    )

    return link?.webhookSecret ?? null
  }
}

/**
 * Отправка по сети.
 *
 * Таймаут обязателен: молчащий получатель без него держит проход очереди
 * до бесконечности, и из-за одной неотвечающей кассы встают все остальные.
 */
async function httpSend(input: {
  url: string
  body: string
  signature: string
  timestamp: number
}): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Positive-Signature': input.signature,
        'X-Positive-Timestamp': String(input.timestamp),
      },
      body: input.body,
      signal: controller.signal,
    })

    return { ok: response.ok, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}
