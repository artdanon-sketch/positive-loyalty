import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type {
  IssuePosGrantInput,
  IssuePosGrantResult,
  VoidPosGrantResult,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import { GrantCodeTakenError, OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Промокод POSitive в кошельке гостя (заведено 20.11.2026).
 *
 * Владелец POSitive создаёт промокод в своём приложении («ИРА20 — −20% в Кефире и
 * ThaiNuki до 31.12») и шлёт его гостю сообщением. Если указан телефон гостя, а у
 * точки есть связка с Loyalty, POSitive кладёт тот же код сюда — гостю в кошелёк.
 *
 * ─── ЧТО ЗДЕСЬ СОЗНАТЕЛЬНО НЕ ТАК, КАК У ПОДАРКА ИЗ КАРТОЧКИ ────────────────
 *
 * • Код СВОЙ, а не сгенерированный: гостю его уже прислали словами. Поэтому
 *   уникальность кода — внутри заведения (`@@unique([tenantId, code])`), и один
 *   промокод на две точки живёт двумя строками с одним текстом.
 * • Срок — точная дата из POSitive, а не «N дней от выдачи».
 * • Лимита «20 подарков в сутки» нет: выдаёт не менеджер у стойки, а связка
 *   кассы по решению владельца, и сам промокод ограничен на стороне POSitive.
 * • Гостя НЕ заводим: телефон не участника — 404. Завести участника без его
 *   согласия на программу — ровно то, от чего защищает OTP при регистрации.
 *
 * Скидку считает и гасит касса POSitive по своим правилам. Здесь — витрина
 * кошелька и одноразовость кода внутри заведения.
 */

/** Префикс ключа идемпотентности: не пересекается с подарками из карточки (`gift:`). */
const NONCE_PREFIX = 'posgrant'

/** Срок хранится точной датой, но `issue` требует дни — для своих кодов они не читаются. */
const UNUSED_VALIDITY_DAYS = 0

@Injectable()
export class PosGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
    private readonly audit: AuditService,
  ) {}

  async issue(input: IssuePosGrantInput, idempotencyKey: string): Promise<IssuePosGrantResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()
    const now = new Date()
    const expiresAt = new Date(input.expiresAt)
    const nonce = `${NONCE_PREFIX}:${tenantId}:${idempotencyKey}`

    const already = await this.grants.findByIdempotencyKey(tenantId, nonce)

    if (already !== null) {
      if (already.code !== input.code) {
        throw new ConflictException({
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Этим ключом уже выдан другой код',
          },
        })
      }

      return this.view(already, true)
    }

    if (expiresAt <= now) {
      throw new BadRequestException({
        error: { code: 'ALREADY_EXPIRED', message: 'Срок промокода уже прошёл' },
      })
    }

    const target = await this.prisma.forTenant(tenantId, async (tx) => {
      const guest = await tx.guest.findFirst({
        where: { phoneE164: input.phone },
        select: { id: true },
      })
      const membership =
        guest === null
          ? null
          : await tx.membership.findFirst({
              where: { guestId: guest.id, tenantId },
              select: { id: true },
            })

      if (guest === null || membership === null) {
        throw new NotFoundException({
          error: {
            code: 'GUEST_NOT_FOUND',
            message: 'Гость с этим телефоном не участвует в программе заведения',
          },
        })
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
            howTo: {
              ru: input.howTo ?? ['Назовите код на кассе'],
              en: input.howTo ?? ['Tell the code at the till'],
            },
          },
        },
        select: { id: true },
      })

      return { guestId: guest.id, offerId: offer.id }
    })

    let grant
    try {
      grant = await this.grants.issue({
        offerId: target.offerId,
        guestId: target.guestId,
        tenantId,
        validityDays: UNUSED_VALIDITY_DAYS,
        expiresAt,
        code: input.code,
        idempotencyKey: nonce,
        now,
      })
    } catch (error) {
      await this.endOffer(tenantId, target.offerId)

      if (error instanceof GrantCodeTakenError) {
        throw new ConflictException({
          error: { code: 'CODE_TAKEN', message: `Код ${input.code} уже выдан в этом заведении` },
        })
      }

      throw error
    }

    if (grant.replayed) {
      // Два одинаковых запроса одновременно: код родился у первого, разовая акция
      // второго осталась пустой — закрываем, чтобы не висела в списке акций.
      if (grant.offerId !== target.offerId) {
        await this.endOffer(tenantId, target.offerId)
      }

      return this.view(grant, true)
    }

    await this.audit.write({
      action: 'GIFT_ISSUED',
      actorType: 'SYSTEM',
      actorId,
      tenantId,
      entityType: 'OfferGrant',
      entityId: grant.id,
      newValue: {
        guestId: target.guestId,
        code: grant.code,
        title: input.title,
        expiresAt: grant.expiresAt.toISOString(),
        source: 'positive-promo',
      },
      reason: 'Промокод POSitive',
      requestId,
    })

    return this.view(grant, false)
  }

  /**
   * Снять промокод из кошелька: в POSitive его убрали в архив.
   *
   * Погашенный не трогаем — подарок уже отдан. Повтор безопасен: второй вызов
   * отвечает `voided: false` с текущим состоянием.
   */
  async void(rawCode: string): Promise<VoidPosGrantResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()
    const code = rawCode.trim().toUpperCase()

    const result = await this.prisma.forTenant(tenantId, async (tx) => {
      const grant = await tx.offerGrant.findFirst({
        where: { tenantId, code },
        select: { id: true, offerId: true, state: true },
      })

      if (grant === null) {
        return null
      }

      const changed = await tx.offerGrant.updateMany({
        where: { id: grant.id, state: 'ISSUED' },
        data: { state: 'VOID' },
      })

      if (changed.count === 1) {
        await tx.offer.updateMany({
          where: { id: grant.offerId, tenantId, type: 'GOODWILL' },
          data: { status: 'ENDED' },
        })
      }

      return {
        id: grant.id,
        voided: changed.count === 1,
        state: changed.count === 1 ? ('VOID' as const) : grant.state,
      }
    })

    if (result === null) {
      throw new NotFoundException({
        error: { code: 'GRANT_NOT_FOUND', message: 'Такого кода нет' },
      })
    }

    if (result.voided) {
      await this.audit.write({
        action: 'GIFT_VOIDED',
        actorType: 'SYSTEM',
        actorId,
        tenantId,
        entityType: 'OfferGrant',
        entityId: result.id,
        newValue: { code, state: 'VOID', source: 'positive-promo' },
        reason: 'Промокод POSitive снят',
        requestId,
      })
    }

    return { code, voided: result.voided, state: result.state }
  }

  private async endOffer(tenantId: string, offerId: string): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offer.updateMany({
        where: { id: offerId, tenantId, type: 'GOODWILL' },
        data: { status: 'ENDED' },
      }),
    )
  }

  private view(
    grant: { id: string; code: string; expiresAt: Date },
    replayed: boolean,
  ): IssuePosGrantResult {
    return {
      grantId: grant.id,
      code: grant.code,
      expiresAt: grant.expiresAt.toISOString(),
      replayed,
    }
  }
}
