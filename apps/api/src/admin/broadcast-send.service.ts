import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { TelegramBotService } from '../identity/telegram-bot.service'

/**
 * Отправка рассылок. docs/02, раздел 5.4.
 *
 * ПОРЦИЯМИ И В ФОНЕ. Запрос владельца не ждёт тысячу обращений к Telegram:
 * «отправить» создаёт список получателей, а сюда приходит фоновый проход.
 *
 * ОДИН ПОЛУЧАТЕЛЬ — ОДНА СТРОКА, и она обновляется сразу после ответа Telegram.
 * Проход, упавший посередине, не отправит уже отправленное второй раз: следующий
 * возьмёт только тех, кто остался в PENDING.
 *
 * ОТКАЗ TELEGRAM — НЕ ПОЛОМКА РАССЫЛКИ. Гость, закрывший бота, отвечает ошибкой
 * «bot was blocked»; это судьба одного получателя, а не повод остановить остальные.
 * Текст ошибки сохраняется — владельцу в архиве видно, почему не дошло.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, как и остальные разгребатели (docs/09, Э3).
 */

/** Сколько сообщений отправляем за один проход: у Telegram предел около 30 в секунду. */
const BATCH = 20

/** Сколько рассылок берём за проход: обычно работает одна, но очередь не должна вставать. */
const BROADCASTS_PER_TICK = 3

export interface BroadcastTickResult {
  readonly sent: number
  readonly failed: number
}

@Injectable()
export class BroadcastSendService {
  private readonly logger = new Logger(BroadcastSendService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramBotService,
  ) {}

  /**
   * Один проход: отправить то, что созрело.
   *
   * Заведения берутся из самих рассылок, а не перебором всех: заведение без
   * рассылок не должно стоить ни одного запроса.
   */
  async tick(now: Date = new Date()): Promise<BroadcastTickResult> {
    if (!this.telegram.enabled) {
      // Бот не настроен — слать нечем. Молчим: это состояние среды, а не сбой.
      return { sent: 0, failed: 0 }
    }

    // Владельцем базы, без tenant-контекста: разгребатель работает за все заведения
    // сразу. Дальше каждая рассылка обрабатывается внутри forTenant своего заведения.
    const due = await this.prisma.broadcast.findMany({
      where: { status: { in: ['SCHEDULED', 'SENDING'] }, sendAt: { lte: now } },
      orderBy: [{ sendAt: 'asc' }, { id: 'asc' }],
      take: BROADCASTS_PER_TICK,
      select: { id: true, tenantId: true, text: true },
    })

    let sent = 0
    let failed = 0

    for (const broadcast of due) {
      const result = await this.send(broadcast.tenantId, broadcast.id, broadcast.text, now)
      sent += result.sent
      failed += result.failed
    }

    return { sent, failed }
  }

  private async send(
    tenantId: string,
    broadcastId: string,
    text: string,
    now: Date,
  ): Promise<BroadcastTickResult> {
    const pending = await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.broadcast.updateMany({
        where: { id: broadcastId, tenantId, status: 'SCHEDULED' },
        data: { status: 'SENDING', startedAt: now },
      })

      return this.batch(tx, tenantId, broadcastId)
    })

    if (pending.length === 0) {
      await this.finish(tenantId, broadcastId, now)
      return { sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0

    for (const recipient of pending) {
      const outcome = await this.deliver(recipient.chatId, text)

      await this.prisma.forTenant(tenantId, async (tx) =>
        tx.broadcastRecipient.updateMany({
          where: { id: recipient.id, tenantId },
          data:
            outcome === null
              ? { delivery: 'SENT', channel: 'TELEGRAM', sentAt: new Date() }
              : { delivery: 'FAILED', channel: 'TELEGRAM', error: outcome },
        }),
      )

      if (outcome === null) {
        sent += 1
      } else {
        failed += 1
      }
    }

    return { sent, failed }
  }

  /** Очередная порция: получатели, которым ещё не слали, вместе с их chat id. */
  private async batch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    broadcastId: string,
  ): Promise<Array<{ id: string; chatId: string }>> {
    const rows = await tx.broadcastRecipient.findMany({
      where: { tenantId, broadcastId, delivery: 'PENDING' },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, guestId: true },
    })

    if (rows.length === 0) {
      return []
    }

    const identities = await tx.guestIdentity.findMany({
      where: { guestId: { in: rows.map((row) => row.guestId) }, provider: 'TELEGRAM' },
      select: { guestId: true, externalId: true },
    })
    const chats = new Map(identities.map((identity) => [identity.guestId, identity.externalId]))

    // Гость мог отвязать Telegram между созданием и отправкой — это не ошибка
    // доставки, а исчезнувший канал.
    const gone = rows.filter((row) => !chats.has(row.guestId)).map((row) => row.id)

    if (gone.length > 0) {
      await tx.broadcastRecipient.updateMany({
        where: { id: { in: gone }, tenantId },
        data: { delivery: 'SKIPPED_NO_CHANNEL' },
      })
    }

    return rows.flatMap((row) => {
      const chatId = chats.get(row.guestId)
      return chatId === undefined ? [] : [{ id: row.id, chatId }]
    })
  }

  /** Отправить одному. null — дошло, строка — причина отказа. */
  private async deliver(chatId: string, text: string): Promise<string | null> {
    try {
      await this.telegram.api.sendMessage(chatId, text)
      return null
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
    }
  }

  /** Рассылка закрывается, когда не осталось никого в ожидании. */
  private async finish(tenantId: string, broadcastId: string, now: Date): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) => {
      const left = await tx.broadcastRecipient.count({
        where: { tenantId, broadcastId, delivery: 'PENDING' },
      })

      if (left > 0) {
        return
      }

      await tx.broadcast.updateMany({
        where: { id: broadcastId, tenantId, status: { in: ['SCHEDULED', 'SENDING'] } },
        data: { status: 'SENT', finishedAt: now },
      })
    })

    this.logger.log(`Рассылка ${broadcastId} отправлена`)
  }
}
