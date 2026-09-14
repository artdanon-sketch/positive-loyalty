import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { offerTitle } from '@positive/contracts'
import type { GiftReason, IssueGiftInput, IssueGiftResult } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import type { AuditActorType } from '../core/audit.service'
import { OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Подарок гостю из карточки. docs/10, разделы 5.2 и 6.11 · docs/02, раздел 5.2.1.
 *
 * ─── ЧЕРЕЗ ОБЩУЮ ВЫДАЧУ, А НЕ МИМО НЕЁ ──────────────────────────────────────
 *
 * Подарок — обычный промокод по акции вида GOODWILL на одного гостя. Значит,
 * он сам появляется у гостя в приложении, гасится на кассе тем же эндпоинтом
 * и виден в истории гостя. Третьего способа дарить не появляется.
 *
 * ─── ПОВТОР НЕ ДАРИТ ДВАЖДЫ ─────────────────────────────────────────────────
 *
 * Ключ из заголовка ложится в nonce промокода, у которой UNIQUE на всю базу.
 * Поэтому заведение входит в ключ: два заведения, случайно придумавшие один
 * ключ, иначе столкнулись бы. Повтор находит первый подарок до создания
 * новой акции; гонка двух одинаковых запросов упирается в UNIQUE, и лишняя
 * акция тут же закрывается.
 *
 * ─── МЕНЕДЖЕР — НЕ БОЛЬШЕ ДВАДЦАТИ ЗА СУТКИ ─────────────────────────────────
 *
 * Подарок стоит заведению денег, а матрица прав (docs/05) отдаёт деньги
 * владельцу. Менеджеру подарок нужен у стойки — и двадцати в сутки на всё
 * заведение для этого с запасом. Сорок первый десерт за день — это уже не спор
 * с гостем, а раздача, и её владелец должен увидеть. Владельца лимит не держит.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const MANAGER_GIFTS_PER_DAY = 20

const REASON_TEXT: Readonly<Record<GiftReason, string>> = {
  LONG_WAIT: 'Долго ждал',
  STAFF_ERROR: 'Ошибка персонала',
  COMPLAINT: 'Жалоба гостя',
  CELEBRATION: 'Праздник гостя',
  OTHER: 'Другое',
}

const ACTOR_TYPES: Readonly<Record<string, AuditActorType>> = {
  CASHIER: 'CASHIER',
  MANAGER: 'MANAGER',
  OWNER: 'OWNER',
}

@Injectable()
export class GuestGiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    guestId: string,
    input: IssueGiftInput,
    idempotencyKey: string,
  ): Promise<IssueGiftResult> {
    const { tenantId, role, actorId, requestId } = TenantContext.getOrThrow()
    const now = new Date()
    const nonce = `gift:${tenantId}:${idempotencyKey}`

    const already = await this.grants.findByIdempotencyKey(tenantId, nonce)

    if (already !== null) {
      if (already.guestId !== guestId) {
        throw new ConflictException({
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Этим ключом уже подарили другому гостю',
          },
        })
      }

      return this.replay(tenantId, already.id)
    }

    const offerId = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { guestId, tenantId },
        select: { id: true },
      })

      if (membership === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Гость не найден' },
        })
      }

      if (role !== 'OWNER') {
        const lastDay = await tx.offerGrant.count({
          where: {
            tenantId,
            issuedAt: { gte: new Date(now.getTime() - DAY_MS) },
            offer: { type: 'GOODWILL' },
          },
        })

        if (lastDay >= MANAGER_GIFTS_PER_DAY) {
          throw new ConflictException({
            error: {
              code: 'GIFT_LIMIT',
              message: `За сутки заведение уже подарило ${MANAGER_GIFTS_PER_DAY} подарков — дальше может только владелец`,
              details: { limit: MANAGER_GIFTS_PER_DAY },
            },
          })
        }
      }

      const offer = await tx.offer.create({
        data: {
          tenantId,
          type: 'GOODWILL',
          status: 'LIVE',
          visibility: 'VENUE_ONLY',
          audience: {},
          schedule: {},
          limits: { totalQty: 1, perGuestQty: 1 },
          reward: { kind: 'FREE_ITEM', itemName: input.title, minCheck: 0 },
          i18n: {
            title: { ru: input.title, en: input.title },
            howTo: { ru: ['Покажите код на кассе'], en: ['Show the code at the till'] },
          },
        },
        select: { id: true },
      })

      return offer.id
    })

    const grant = await this.grants.issue({
      offerId,
      guestId,
      tenantId,
      validityDays: input.validityDays,
      idempotencyKey: nonce,
      now,
    })

    if (grant.replayed) {
      // Одинаковый запрос пришёл дважды одновременно: промокод родился у первого,
      // а акция второго осталась без подарка. Закрываем её, чтобы не висела.
      if (grant.offerId !== offerId) {
        await this.prisma.forTenant(tenantId, async (tx) =>
          tx.offer.updateMany({ where: { id: offerId, tenantId }, data: { status: 'ENDED' } }),
        )
      }

      return this.replay(tenantId, grant.id)
    }

    await this.audit.write({
      action: 'GIFT_ISSUED',
      actorType: ACTOR_TYPES[role ?? ''] ?? 'MANAGER',
      actorId,
      tenantId,
      entityType: 'OfferGrant',
      entityId: grant.id,
      newValue: {
        guestId,
        title: input.title,
        reason: input.reason,
        validityDays: input.validityDays,
      },
      reason:
        input.comment === undefined
          ? REASON_TEXT[input.reason]
          : `${REASON_TEXT[input.reason]}: ${input.comment}`,
      requestId,
    })

    return {
      grantId: grant.id,
      title: input.title,
      codeTail: grant.code.slice(-4),
      expiresAt: grant.expiresAt.toISOString(),
      replayed: false,
    }
  }

  /** Первый ответ на повтор: тот же подарок, прочитанный из базы. */
  private async replay(tenantId: string, grantId: string): Promise<IssueGiftResult> {
    const row = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offerGrant.findFirst({
        where: { id: grantId, tenantId },
        select: { code: true, expiresAt: true, offer: { select: { i18n: true } } },
      }),
    )

    if (row === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Подарок не найден' },
      })
    }

    return {
      grantId,
      title: offerTitle(row.offer.i18n, 'ru') ?? '',
      codeTail: row.code.slice(-4),
      expiresAt: row.expiresAt.toISOString(),
      replayed: true,
    }
  }
}
