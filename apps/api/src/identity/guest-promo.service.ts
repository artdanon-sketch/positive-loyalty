import { Injectable, NotFoundException } from '@nestjs/common'
import { CertificateOfferReward, offerHowTo, offerTitle } from '@positive/contracts'
import type { ClaimedPromoCertificate, PromoCertificate } from '@positive/contracts'

import { OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'

import { currentGuestId } from './current-guest'

/**
 * Промо-сертификаты в приложении гостя: их гость забирает сам. docs/02, раздел 5.11.
 *
 * НАДСТРОЙКА НАД OFFER, А НЕ ТРЕТИЙ СПОСОБ ДАРИТЬ. Промо-сертификат — тот же
 * шаблон вида GIFT_CARD, что и обычный, только с флагом selfClaim. «Забрать» —
 * это обычная выдача через OfferGrantService: промокод ложится гостю в кошелёк
 * и гасится на кассе как любой другой. Ничего своего для погашения не заводим.
 *
 * ГРАНИЦУ ЧТЕНИЯ ДЕРЖИТ БАЗА: политика `guest_promo_offers` (миграция
 * 20260919140000) отдаёт только LIVE self-claim GIFT_CARD заведений, где у гостя
 * есть участие. Выключенный или чужой промо гость не видит и не заберёт.
 *
 * ОДИН НА ГОСТЯ. Ключ идемпотентности `promo:{offerId}:{guestId}`: повторное
 * «Забрать» возвращает тот же промокод, а не выдаёт второй. Общего тиража в v1
 * нет — промо живёт, пока заведение держит его включённым.
 */
@Injectable()
export class GuestPromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
  ) {}

  async list(): Promise<PromoCertificate[]> {
    const guestId = currentGuestId()

    const { offers, locale, claimedIds } = await this.prisma.forGuest(guestId, async (tx) => {
      const guest = await tx.guest.findFirst({ where: { id: guestId }, select: { locale: true } })

      const rows = await tx.offer.findMany({
        where: {
          type: 'GIFT_CARD',
          status: 'LIVE',
          selfClaim: true,
          tenant: { memberships: { some: { guestId } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          tenantId: true,
          reward: true,
          i18n: true,
          tenant: { select: { brandName: true } },
        },
      })

      // Уже забранные — чтобы кнопка «Забрать» погасла. Любое состояние гранта
      // считается «забрал»: промо на гостя одно, повтор вернул бы тот же код.
      const claimed =
        rows.length === 0
          ? []
          : await tx.offerGrant.findMany({
              where: { guestId, offerId: { in: rows.map((row) => row.id) } },
              select: { offerId: true },
            })

      return {
        offers: rows,
        locale: guest?.locale ?? 'ru',
        claimedIds: new Set(claimed.map((row) => row.offerId)),
      }
    })

    // Шаблон с неразборчивой наградой пропускаем, а не роняем весь список.
    return offers.flatMap((offer): PromoCertificate[] => {
      const reward = CertificateOfferReward.safeParse(offer.reward)

      if (!reward.success) {
        return []
      }

      return [
        {
          offerId: offer.id,
          tenantId: offer.tenantId,
          venue: offer.tenant.brandName,
          title: offerTitle(offer.i18n, locale) ?? '',
          value: reward.data.value,
          validityDays: reward.data.validityDays,
          howTo: [...offerHowTo(offer.i18n, locale)],
          claimed: claimedIds.has(offer.id),
        },
      ]
    })
  }

  async claim(offerId: string): Promise<ClaimedPromoCertificate> {
    const guestId = currentGuestId()

    // Читаем под гостевым контуром: RLS отдаст акцию, только если это живой
    // self-claim промо заведения, где гость участвует. Значит, что можно
    // прочитать, то и можно забрать — отдельной проверки прав не нужно.
    const offer = await this.prisma.forGuest(guestId, async (tx) =>
      tx.offer.findFirst({
        where: {
          id: offerId,
          type: 'GIFT_CARD',
          status: 'LIVE',
          selfClaim: true,
          tenant: { memberships: { some: { guestId } } },
        },
        select: { id: true, tenantId: true, reward: true },
      }),
    )

    const reward = offer === null ? null : CertificateOfferReward.safeParse(offer.reward)

    if (offer === null || reward === null || !reward.success) {
      // 404, а не 403: по ответу не должно быть видно, что промо существует.
      throw new NotFoundException({
        error: { code: 'PROMO_NOT_FOUND', message: 'Промо-сертификат не найден' },
      })
    }

    // Выдача идёт через общий сервис — он открывает тенантный контур сам
    // (гостю писать грант RLS не даёт). Ключ идемпотентности — один на гостя.
    const grant = await this.grants.issue({
      offerId: offer.id,
      guestId,
      tenantId: offer.tenantId,
      validityDays: reward.data.validityDays,
      idempotencyKey: `promo:${offer.id}:${guestId}`,
      now: new Date(),
    })

    return { offerId: offer.id, code: grant.code, expiresAt: grant.expiresAt.toISOString() }
  }
}
