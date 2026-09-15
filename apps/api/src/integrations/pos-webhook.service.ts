import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { PosWebhookEnvelope } from '@positive/contracts'
import type { PosWebhookAccepted } from '@positive/contracts'

import { verifyWebhookSignature } from './webhook-signature'
import { LedgerService } from '../core/ledger.service'
import { MEMBERSHIP_RULES_SELECT, MembershipRulesService } from '../core/membership-rules.service'
import type { MembershipSnapshot, ReferralFacts } from '../core/membership-rules.service'
import { PrismaService } from '../core/prisma.service'
import { verifyGuestQrToken } from '../common/tenant/access-token'
import { getEnv } from '../common/config/env'
import { parseProgramConfig } from '@positive/contracts'
import type { ProgramConfig } from '@positive/contracts'

/**
 * Приём вебхуков от POSitive POS. docs/02, раздел 4 · docs/01, раздел 3.2.
 *
 * ПРИЁМ И ОБРАБОТКА РАЗДЕЛЕНЫ, и это требование ТЗ, а не удобство: касса
 * не должна ждать нашу бизнес-логику. Приём — одна вставка строки в
 * `WebhookEvent` и ответ `202`. Обработка идёт следом, уже без кассы на линии.
 *
 * ТАБЛИЦА И ЕСТЬ ОЧЕРЕДЬ. Альтернатива — писать строку сюда И класть задачу
 * в Redis — заводит два независимых хранилища и две новые поломки: строка без
 * задачи (событие принято и потеряно) и задача без строки (дедупликация не
 * сработала, чек начислен дважды). Приём обязан быть ОДНОЙ транзакцией.
 * Когда понадобится разнести обработку по процессам, воркер будет разбирать
 * ту же таблицу — строки со статусом PENDING никуда не денутся.
 *
 * ПОРЯДОК ПРОВЕРОК ЗДЕСЬ — ЧАСТЬ ЗАЩИТЫ. Сначала находим связь и проверяем
 * подпись, и только потом разбираем тело. Разбирать неподписанное значит
 * тратить процессор на то, что прислал кто угодно.
 */

/** Сколько раз пробуем обработать событие, прежде чем позвать человека. */
const MAX_ATTEMPTS = 5

@Injectable()
export class PosWebhookService {
  private readonly logger = new Logger(PosWebhookService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rules: MembershipRulesService,
  ) {}

  /**
   * Принимает событие: проверяет подпись, дедуплицирует, кладёт в очередь.
   *
   * Возвращается быстро. Всё, что дольше вставки строки, происходит после.
   */
  async accept(input: {
    rawBody: Buffer
    signature: string | undefined
    timestamp: string | undefined
    idempotencyKey: string | undefined
  }): Promise<PosWebhookAccepted> {
    // Тело нужно разобрать дважды: сейчас — чтобы достать posMerchantId и найти
    // ключ, и после проверки — начисто. Первый разбор ничему не доверяет
    // и достаёт ровно одно поле.
    const merchantId = readMerchantId(input.rawBody)

    if (merchantId === null) {
      // Тот же ответ, что и на плохую подпись: по разнице ответов иначе видно,
      // существует заведение или нет, и чужой merchantId подбирается перебором.
      throw this.rejected('MALFORMED_BODY')
    }

    const link = await this.findLink(merchantId)

    if (link === null) {
      throw this.rejected('UNKNOWN_MERCHANT')
    }

    const check = verifyWebhookSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signature,
      timestampHeader: input.timestamp,
      secret: link.webhookSecret,
      nowSeconds: Math.floor(Date.now() / 1000),
    })

    if (!check.ok) {
      throw this.rejected(check.reason)
    }

    const parsed = PosWebhookEnvelope.safeParse(JSON.parse(input.rawBody.toString('utf8')))

    if (!parsed.success) {
      throw this.rejected('MALFORMED_BODY')
    }

    // Ключ идемпотентности берём из заголовка, а если его нет — из чека:
    // касса обязана слать заголовок, но чек и так уникален, и терять событие
    // из-за забытого заголовка нельзя.
    const externalId = input.idempotencyKey ?? parsed.data.receipt.id

    const existing = await this.prisma.forTenant(link.tenantId, async (tx) =>
      tx.webhookEvent.findFirst({
        where: { tenantId: link.tenantId, externalId },
        select: { id: true },
      }),
    )

    if (existing !== null) {
      // Повтор — нормальная работа кассы с плохой связью, а не ошибка.
      return { eventId: existing.id, duplicate: true }
    }

    const event = await this.prisma.forTenant(link.tenantId, async (tx) =>
      tx.webhookEvent.create({
        data: {
          tenantId: link.tenantId,
          source: 'pos',
          eventType: parsed.data.event,
          externalId,
          // Разобранный конверт, а не сырое тело: в базу ложится то, что мы
          // поняли, — иначе повторная обработка разбирала бы заново и могла
          // разойтись с первой попыткой, если схема между ними изменилась.
          payload: parsed.data,
        },
        select: { id: true },
      }),
    )

    // Обработка идёт следом и НЕ ЖДЁТСЯ: касса получает 202 сразу. Если процесс
    // упадёт между приёмом и обработкой, строка останется PENDING — её подберёт
    // повторный проход. Именно поэтому очередь и живёт в базе.
    void this.process(event.id, link.tenantId)

    return { eventId: event.id, duplicate: false }
  }

  /**
   * Обрабатывает принятое событие. Ошибки не выбрасывает: их некому ловить.
   *
   * Публичный, потому что тот же метод вызывает восстановительный проход
   * по строкам PENDING — тестом он тоже дёргается напрямую.
   */
  async process(eventId: string, tenantId: string): Promise<void> {
    try {
      const event = await this.prisma.forTenant(tenantId, async (tx) =>
        tx.webhookEvent.findFirst({ where: { id: eventId, tenantId } }),
      )

      if (event === null || event.status !== 'PENDING') {
        return
      }

      const envelope = PosWebhookEnvelope.parse(event.payload)
      const outcome = await this.apply(envelope, tenantId)

      await this.prisma.forTenant(tenantId, async (tx) => {
        await tx.webhookEvent.updateMany({
          where: { id: eventId, tenantId },
          data: {
            status: outcome,
            attempts: { increment: 1 },
            processedAt: new Date(),
            lastError: null,
          },
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      await this.prisma
        .forTenant(tenantId, async (tx) => {
          const current = await tx.webhookEvent.findFirst({
            where: { id: eventId, tenantId },
            select: { attempts: true },
          })
          const attempts = (current?.attempts ?? 0) + 1

          await tx.webhookEvent.updateMany({
            where: { id: eventId, tenantId },
            data: {
              // Пока попытки не исчерпаны, событие остаётся в очереди
              // и будет подобрано повторным проходом.
              status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
              attempts,
              lastError: message.slice(0, 500),
            },
          })
        })
        .catch(() => {
          // База недоступна целиком. Событие останется PENDING — это и есть
          // правильный исход: его подберут, когда база вернётся.
        })

      // Тело события не логируем: в нём чек, а с ним и следы гостя.
      this.logger.warn(`Событие ${eventId} не обработано: ${message}`)
    }
  }

  /** Применяет событие к журналу. Возвращает итоговый статус. */
  private async apply(
    envelope: PosWebhookEnvelope,
    tenantId: string,
  ): Promise<'PROCESSED' | 'SKIPPED'> {
    if (envelope.event === 'receipt.voided') {
      return this.applyVoid(envelope, tenantId)
    }

    const membership = await this.resolveMembership(envelope, tenantId)

    if (membership === null) {
      // Чек без гостя. Это НЕ ошибка: событие нужно ради доли чеков
      // с программой — главной метрики проникновения (docs/02, раздел 4.1).
      return 'SKIPPED'
    }

    const config = await this.loadConfig(tenantId)
    // Чек из кассы POSitive считается по тем же ставкам статуса, что и чек в бэк-офисе.
    const { rates } = await this.prisma.forTenant(tenantId, async (tx) =>
      this.rules.tierFor(tx, tenantId, config, membership),
    )
    const amount = Math.floor((envelope.receipt.total * rates.earnRate) / 100)

    // Приветственные баллы за первую покупку — до начисления, как и на кассе.
    await this.rules.grantWelcome(tenantId, membership, config, 'FIRST_PURCHASE')
    // И награда пригласившему за первую покупку друга — тоже до начисления.
    await this.rules.grantReferral(tenantId, membership, config)

    await this.ledger.earn(
      {
        membershipId: membership.id,
        amount,
        basisAmount: envelope.receipt.total,
        // Ключ — идентификатор чека кассы: повтор того же чека любым путём
        // (вебхук, ручной ввод, досылка смены) не начислит второй раз.
        idempotencyKey: `pos:earn:${envelope.receipt.id}`,
        refType: 'receipt',
        refId: envelope.receipt.id,
        // Время СОБЫТИЯ: вебхук опаздывает, а чек закрыт тогда, когда закрыт.
        //
        // Приводится к UTC ЗДЕСЬ, на границе. Касса присылает местное время
        // со смещением («…T19:31:05+07:00» — ровно как в примере docs/02,
        // раздел 4.1), а журнал принимает одно каноническое представление.
        // Послабить контракт журнала было бы проще и хуже: два вида записи
        // одного и того же момента разъедутся при первом же сравнении дат.
        // Перевод чужого формата в свой — и есть работа интеграционного слоя.
        occurredAt: new Date(envelope.receipt.closedAt).toISOString(),
        source: 'POS_WEBHOOK',
        actorType: 'SYSTEM',
      },
      { tenantId },
    )

    await this.rules.refreshTier(tenantId, membership.id, config)
    await this.rules.refreshInviterTier(tenantId, membership, config)

    return 'PROCESSED'
  }

  /** Отмена чека кассой: компенсируем все его ноги. */
  private async applyVoid(
    envelope: PosWebhookEnvelope,
    tenantId: string,
  ): Promise<'PROCESSED' | 'SKIPPED'> {
    const legs = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          tenantId,
          refType: 'receipt',
          refId: envelope.receipt.id,
          type: { in: ['EARN', 'REDEEM'] },
        },
        select: { id: true, idempotencyKey: true },
      }),
    )

    if (legs.length === 0) {
      // Отменяют чек, которого у нас нет: гостя на нём не опознали, начислять
      // было нечего. Отменять тоже нечего — и это не ошибка.
      return 'SKIPPED'
    }

    for (const leg of legs) {
      await this.ledger.reverse(
        {
          entryId: leg.id,
          idempotencyKey: `pos:void:${leg.idempotencyKey}`,
          reason: 'RECEIPT_VOIDED',
          source: 'POS_WEBHOOK',
          actorType: 'SYSTEM',
        },
        { tenantId },
      )
    }

    return 'PROCESSED'
  }

  /**
   * Находит участие гостя по токену с экрана.
   *
   * `null` означает «чек без гостя» — штатный исход, а не сбой.
   */
  private async resolveMembership(
    envelope: PosWebhookEnvelope,
    tenantId: string,
  ): Promise<(MembershipSnapshot & ReferralFacts) | null> {
    const token = envelope.receipt.loyalty?.guestToken

    if (token === undefined) {
      return null
    }

    const { accessTokenSecret } = getEnv()
    const claims = verifyGuestQrToken(token, accessTokenSecret)

    const membership = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.findFirst({
        where: { tenantId, guestId: claims.guestId },
        select: MEMBERSHIP_RULES_SELECT,
      }),
    )

    return membership
  }

  private async loadConfig(tenantId: string): Promise<ProgramConfig> {
    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    return parseProgramConfig(tenant?.settings ?? {})
  }

  private async findLink(
    merchantId: string,
  ): Promise<{ tenantId: string; webhookSecret: string } | null> {
    // Через функцию SECURITY DEFINER: политика RLS на PosLink требует
    // объявленного заведения, а его-то мы и ищем. Функция отдаёт ровно два
    // значения и только для действующей связи — подробности в миграции.
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string; webhookSecret: string }>>`
      SELECT * FROM pos_link_for_merchant(${merchantId}::text)
    `

    return rows[0] ?? null
  }

  /**
   * Единый отказ на все причины.
   *
   * Причина уходит в лог, а наружу — один и тот же ответ. По разнице
   * сообщений иначе видно, существует ли заведение и какой из проверок
   * не хватило, — а это подсказка тому, кто подбирает.
   */
  private rejected(reason: string): UnauthorizedException {
    this.logger.warn(`Вебхук отклонён: ${reason}`)

    return new UnauthorizedException({
      error: { code: 'WEBHOOK_REJECTED', message: 'Подпись или отправитель не приняты' },
    })
  }
}

/**
 * Достаёт `posMerchantId` из сырого тела, ничему не доверяя.
 *
 * Нужен до проверки подписи: без идентификатора нечем найти ключ. Поэтому
 * разбор здесь минимальный — одно поле, и никакой схемы: полноценный разбор
 * неподписанного тела означал бы тратить процессор на то, что прислал кто угодно.
 */
function readMerchantId(rawBody: Buffer): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'))

    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }

    const value = (parsed as { posMerchantId?: unknown }).posMerchantId

    return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null
  } catch {
    return null
  }
}
