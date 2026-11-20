import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { PutPosGrantInput, PutPosGrantResult, VoidPosGrantResult } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import { OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Промокод POSitive в кошельке гостя (заведено 20.11.2026).
 *
 * Владелец POSitive создаёт промокод в своём приложении («IRA20 — −20% в Кефире и
 * ThaiNuki до 31.12») и шлёт его гостю сообщением. Если указан телефон гостя, а у
 * точки есть связка с Loyalty, POSitive кладёт тот же код сюда — гостю в кошелёк.
 *
 * ─── ПОЧЕМУ «ПОЛОЖИТЬ ИЛИ ОБНОВИТЬ ПО КОДУ», А НЕ «ВЫДАТЬ» ─────────────────
 *
 * Промокод живёт в POSitive и меняется там: продлили срок, сменили получателя,
 * выключили и включили снова. Код при этом тот же, а код уникален внутри
 * заведения. Разовая выдача упёрлась бы в собственный след: снятый код второй
 * раз не выдать. Поэтому строка с кодом POSitive — ЗЕРКАЛО промокода: её
 * создаёт первый PUT, следующие правят срок, название и гостя и возвращают её
 * из VOID. Погашенную не трогают — подарок уже отдан.
 *
 * Зеркало узнаётся по ключу `posgrant:<тенант>:<код>` в nonce. Код, выданный
 * самим Loyalty (подарок из карточки, приглашение), им не является: такой PUT —
 * 409 CODE_TAKEN, а не перезапись чужого подарка.
 *
 * ─── ЧТО ЕЩЁ СОЗНАТЕЛЬНО НЕ ТАК, КАК У ПОДАРКА ИЗ КАРТОЧКИ ────────────────
 *
 * • Срок — точная дата из POSitive, а не «N дней от выдачи».
 * • Лимита «20 подарков в сутки» нет: выдаёт не менеджер у стойки, а связка
 *   кассы по решению владельца.
 * • Гостя НЕ заводим: телефон не участника — 404. Завести участника без его
 *   согласия на программу — ровно то, от чего защищает OTP при регистрации.
 *
 * Скидку считает и гасит касса POSitive по своим правилам. Здесь — витрина
 * кошелька и одноразовость кода внутри заведения.
 */

const nonceOf = (tenantId: string, code: string): string => `posgrant:${tenantId}:${code}`

/** Срок хранится точной датой, но `issue` требует дни — для своих кодов они не читаются. */
const UNUSED_VALIDITY_DAYS = 0

type Tx = Parameters<Parameters<PrismaService['forTenant']>[1]>[0]

const offerText = (input: PutPosGrantInput) => ({
  reward: { kind: 'FREE_ITEM', itemName: input.title, minCheck: 0 },
  i18n: {
    title: { ru: input.title, en: input.title },
    howTo: {
      ru: input.howTo ?? ['Назовите код на кассе'],
      en: input.howTo ?? ['Tell the code at the till'],
    },
  },
})

@Injectable()
export class PosGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
    private readonly audit: AuditService,
  ) {}

  async put(code: string, input: PutPosGrantInput): Promise<PutPosGrantResult> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()
    const expiresAt = new Date(input.expiresAt)

    if (expiresAt <= now) {
      throw new BadRequestException({
        error: { code: 'ALREADY_EXPIRED', message: 'Срок промокода уже прошёл' },
      })
    }

    const found = await this.prisma.forTenant(tenantId, async (tx) => {
      const guestId = await this.memberByPhone(tx, tenantId, input.phone)
      const existing = await tx.offerGrant.findFirst({
        where: { tenantId, code },
        select: { id: true, offerId: true, state: true, nonce: true, guestId: true },
      })
      return { guestId, existing }
    })

    if (found.existing !== null) {
      return this.refresh(tenantId, code, found.existing, found.guestId, expiresAt, input)
    }

    return this.create(tenantId, code, found.guestId, expiresAt, input, now)
  }

  /**
   * Снять промокод из кошелька: в POSitive его убрали в архив, выключили или
   * убрали точку. Погашенный не трогаем — подарок уже отдан. Повтор безопасен.
   */
  async void(code: string): Promise<VoidPosGrantResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()

    const result = await this.prisma.forTenant(tenantId, async (tx) => {
      const grant = await tx.offerGrant.findFirst({
        where: { tenantId, code },
        select: { id: true, offerId: true, state: true, nonce: true },
      })

      if (grant === null || grant.nonce !== nonceOf(tenantId, code)) {
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

    // Код подарка самого Loyalty для связки «не существует»: снимать чужие подарки она не вправе.
    if (result === null) {
      throw new NotFoundException({
        error: { code: 'GRANT_NOT_FOUND', message: 'Промокода POSitive с таким кодом нет' },
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

  private async memberByPhone(tx: Tx, tenantId: string, phone: string): Promise<string> {
    const guest = await tx.guest.findFirst({ where: { phoneE164: phone }, select: { id: true } })
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

    return guest.id
  }

  private async create(
    tenantId: string,
    code: string,
    guestId: string,
    expiresAt: Date,
    input: PutPosGrantInput,
    now: Date,
  ): Promise<PutPosGrantResult> {
    const { actorId, requestId } = TenantContext.getOrThrow()

    const offer = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offer.create({
        data: {
          tenantId,
          type: 'GOODWILL',
          status: 'LIVE',
          visibility: 'VENUE_ONLY',
          audience: {},
          schedule: {},
          limits: { totalQty: 1, perGuestQty: 1 },
          ...offerText(input),
        },
        select: { id: true },
      }),
    )

    let grant
    try {
      grant = await this.grants.issue({
        offerId: offer.id,
        guestId,
        tenantId,
        validityDays: UNUSED_VALIDITY_DAYS,
        expiresAt,
        code,
        idempotencyKey: nonceOf(tenantId, code),
        now,
      })
    } catch (error) {
      await this.endOffer(tenantId, offer.id)
      throw error
    }

    if (grant.replayed) {
      // Два PUT одного кода одновременно: строку создал первый, акция второго пустая.
      if (grant.offerId !== offer.id) {
        await this.endOffer(tenantId, offer.id)
      }

      return { grantId: grant.id, code, expiresAt: grant.expiresAt.toISOString(), created: false }
    }

    await this.audit.write({
      action: 'GIFT_ISSUED',
      actorType: 'SYSTEM',
      actorId,
      tenantId,
      entityType: 'OfferGrant',
      entityId: grant.id,
      newValue: {
        guestId,
        code,
        title: input.title,
        expiresAt: expiresAt.toISOString(),
        source: 'positive-promo',
      },
      reason: 'Промокод POSitive',
      requestId,
    })

    return { grantId: grant.id, code, expiresAt: expiresAt.toISOString(), created: true }
  }

  private async refresh(
    tenantId: string,
    code: string,
    existing: { id: string; offerId: string; state: string; nonce: string; guestId: string },
    guestId: string,
    expiresAt: Date,
    input: PutPosGrantInput,
  ): Promise<PutPosGrantResult> {
    const { actorId, requestId } = TenantContext.getOrThrow()

    if (existing.nonce !== nonceOf(tenantId, code)) {
      throw new ConflictException({
        error: { code: 'CODE_TAKEN', message: `Код ${code} уже выдан в этом заведении` },
      })
    }

    if (existing.state === 'REDEEMED') {
      throw new ConflictException({
        error: { code: 'GRANT_ALREADY_USED', message: 'Код уже погашен — подарок отдан' },
      })
    }

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.offer.updateMany({
        where: { id: existing.offerId, tenantId, type: 'GOODWILL' },
        data: { status: 'LIVE', ...offerText(input) },
      })
      // Условие на состояние — в самом UPDATE: погашение, пришедшее между чтением и
      // записью, не превратится обратно в ISSUED.
      const changed = await tx.offerGrant.updateMany({
        where: { id: existing.id, state: { in: ['ISSUED', 'VOID', 'EXPIRED'] } },
        data: { state: 'ISSUED', guestId, expiresAt },
      })

      if (changed.count !== 1) {
        throw new ConflictException({
          error: { code: 'GRANT_ALREADY_USED', message: 'Код уже погашен — подарок отдан' },
        })
      }
    })

    await this.audit.write({
      action: 'GIFT_UPDATED',
      actorType: 'SYSTEM',
      actorId,
      tenantId,
      entityType: 'OfferGrant',
      entityId: existing.id,
      oldValue: { guestId: existing.guestId, state: existing.state },
      newValue: {
        guestId,
        code,
        title: input.title,
        expiresAt: expiresAt.toISOString(),
        state: 'ISSUED',
        source: 'positive-promo',
      },
      reason: 'Промокод POSitive изменён',
      requestId,
    })

    return { grantId: existing.id, code, expiresAt: expiresAt.toISOString(), created: false }
  }

  private async endOffer(tenantId: string, offerId: string): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offer.updateMany({
        where: { id: offerId, tenantId, type: 'GOODWILL' },
        data: { status: 'ENDED' },
      }),
    )
  }
}
