import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { BroadcastGift, CertificateOfferReward } from '@positive/contracts'

import { IdempotencyKeyReusedError, isLedgerError } from '../core/ledger.errors'
import { LedgerService } from '../core/ledger.service'
import { OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Подарки к рассылке: баллы или сертификат каждому из снимка аудитории.
 * docs/02, раздел 5.4.
 *
 * НАДСТРОЙКА НАД ГОТОВЫМ, А НЕ ТРЕТИЙ СПОСОБ ДАРИТЬ. Баллы идут через журнал
 * (`LedgerService.grant`, как подарок ко дню рождения), сертификат — через
 * общую выдачу промокодов. Своего учёта денег здесь нет.
 *
 * ОДИН РАЗ НА ГОСТЯ. Ключ идемпотентности — рассылка плюс гость: проход, упавший
 * посередине, повторит выдачу, и журнал вернёт первую запись, а не вторую.
 *
 * ПОДАРОК — НЕ ДОСТАВКА. Его получает и тот, до кого сообщение не дошло:
 * подарок лежит на карте и ждёт. Поэтому учёт отдельный — `giftAt`, а не
 * статус доставки.
 *
 * КОНТРОЛЬНАЯ ГРУППА ПОДАРКОВ НЕ ПОЛУЧАЕТ — как и подарка ко дню рождения.
 * Иначе сравнивать программу будет не с чем.
 */

/** Сколько подарков за проход: каждый — своя транзакция журнала. */
const GIFT_BATCH = 50

/** Ключ идемпотентности подарка: один на рассылку и гостя. */
export const giftKey = (broadcastId: string, guestId: string): string =>
  `broadcast:${broadcastId}:${guestId}`

/** Разобрать подарок из колонки JSON. Неразборчивый — как отсутствующий. */
export const parseGift = (value: unknown): BroadcastGift | null => {
  const parsed = BroadcastGift.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Сертификат в подарке — живой шаблон своего заведения.
 *
 * Проверяется при сохранении, а не при отправке: владелец узнаёт о выключенном
 * шаблоне сейчас, а не по сотне гостей, оставшихся без обещанного подарка.
 */
export const assertGiftUsable = async (
  tx: Prisma.TransactionClient,
  tenantId: string,
  gift: BroadcastGift | null | undefined,
): Promise<void> => {
  if (gift === null || gift === undefined || gift.kind === 'POINTS') {
    return
  }

  const template = await tx.offer.findFirst({
    where: { id: gift.certificateId, tenantId, type: 'GIFT_CARD', status: 'LIVE' },
    select: { id: true },
  })

  if (template === null) {
    throw new BadRequestException({
      error: {
        code: 'CERTIFICATE_NOT_FOUND',
        message: 'Сертификат не найден или выключен — выберите включённый шаблон',
      },
    })
  }
}

@Injectable()
export class BroadcastGiftService {
  private readonly logger = new Logger(BroadcastGiftService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly grants: OfferGrantService,
  ) {}

  /**
   * Выдать подарки очередной порции получателей.
   *
   * `done` — подарков больше ждать некому: рассылку можно закрывать, когда
   * и доставка закончилась.
   */
  async give(
    tenantId: string,
    broadcastId: string,
    gift: BroadcastGift,
    now: Date,
  ): Promise<{ issued: number; done: boolean }> {
    const batch = await this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.broadcastRecipient.findMany({
        where: { tenantId, broadcastId, giftAt: null },
        orderBy: { id: 'asc' },
        take: GIFT_BATCH,
        select: { id: true, guestId: true },
      })

      if (rows.length === 0) {
        return null
      }

      const memberships = await tx.membership.findMany({
        where: { tenantId, guestId: { in: rows.map((row) => row.guestId) } },
        select: { id: true, guestId: true, isControlGroup: true },
      })

      const template =
        gift.kind === 'CERTIFICATE'
          ? await tx.offer.findFirst({
              where: { id: gift.certificateId, tenantId, type: 'GIFT_CARD', status: 'LIVE' },
              select: { reward: true },
            })
          : null

      return { rows, memberships, template }
    })

    if (batch === null) {
      return { issued: 0, done: true }
    }

    // Шаблон выключили между сохранением и отправкой: выдать нечего. Остаток
    // помечаем пропущенным, чтобы рассылка закрылась, а не ждала вечно, —
    // и владелец видел в архиве, сколько подарков ушло на самом деле.
    let validityDays: number | null = null

    if (gift.kind === 'CERTIFICATE') {
      const reward =
        batch.template === null ? null : CertificateOfferReward.safeParse(batch.template.reward)

      if (reward === null || !reward.success) {
        this.logger.warn(
          `Сертификат ${gift.certificateId} рассылки ${broadcastId} выключен — подарки не выдаются`,
        )
        await this.prisma.forTenant(tenantId, async (tx) =>
          tx.broadcastRecipient.updateMany({
            where: { tenantId, broadcastId, giftAt: null },
            data: { giftAt: now, giftSkipped: true },
          }),
        )
        return { issued: 0, done: true }
      }

      validityDays = reward.data.validityDays
    }

    const byGuest = new Map(batch.memberships.map((membership) => [membership.guestId, membership]))
    let issued = 0

    for (const row of batch.rows) {
      const membership = byGuest.get(row.guestId)

      if (membership === undefined || membership.isControlGroup) {
        await this.mark(tenantId, row.id, now, true)
        continue
      }

      try {
        await this.issue(tenantId, broadcastId, gift, validityDays, membership, row.guestId, now)
        await this.mark(tenantId, row.id, now, false)
        issued += 1
      } catch (error) {
        if (error instanceof IdempotencyKeyReusedError) {
          // Ключ уже занят этим же подарком с другими данными — подарок у гостя есть.
          await this.mark(tenantId, row.id, now, false)
          continue
        }

        if (isLedgerError(error)) {
          // Отказ журнала по существу повтором не лечится: помечаем и идём дальше,
          // чтобы один гость не держал всю рассылку открытой.
          this.logger.warn(`Подарок рассылки ${broadcastId} не выдан: ${error.code}`)
          await this.mark(tenantId, row.id, now, true)
          continue
        }

        // Сбой связи или базы — оставляем на следующий проход.
        this.logger.warn(
          `Подарок рассылки ${broadcastId} отложен: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const left = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.broadcastRecipient.count({ where: { tenantId, broadcastId, giftAt: null } }),
    )

    return { issued, done: left === 0 }
  }

  private async issue(
    tenantId: string,
    broadcastId: string,
    gift: BroadcastGift,
    validityDays: number | null,
    membership: { id: string },
    guestId: string,
    now: Date,
  ): Promise<void> {
    const idempotencyKey = giftKey(broadcastId, guestId)

    if (gift.kind === 'POINTS') {
      await this.ledger.grant(
        {
          membershipId: membership.id,
          amount: gift.amount,
          idempotencyKey,
          refType: 'promo',
          refId: broadcastId,
          source: 'SYSTEM',
          actorType: 'SYSTEM',
        },
        { tenantId },
      )
      return
    }

    await this.grants.issue({
      offerId: gift.certificateId,
      guestId,
      tenantId,
      validityDays: validityDays ?? 30,
      idempotencyKey,
      now,
    })
  }

  private async mark(tenantId: string, id: string, now: Date, skipped: boolean): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) =>
      tx.broadcastRecipient.updateMany({
        where: { id, tenantId },
        data: { giftAt: now, giftSkipped: skipped },
      }),
    )
  }
}
