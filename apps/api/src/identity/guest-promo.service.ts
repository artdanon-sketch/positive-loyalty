import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { CertificateOfferReward, offerHowTo, offerTitle } from '@positive/contracts'
import type { ClaimedPromoCertificate, PromoCertificate } from '@positive/contracts'

import { OfferGrantService, OfferSoldOutError } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'
import { promoLeft, promoOpen, termsOf } from '../core/promo-terms'

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
 * «Забрать» возвращает тот же промокод, а не выдаёт второй.
 *
 * ОКНО И ТИРАЖ (core/promo-terms.ts). Вне окна промо не видно и не берётся —
 * как выключенное. Тираж проверяется в той же транзакции, что и выдача;
 * разошёлся — «закончились», но тот, кто уже взял, свой код видит и получает.
 *
 * ОСТАТОК СЧИТАЕТСЯ ОТ ИМЕНИ ЗАВЕДЕНИЯ. Гостю база показывает только его
 * собственные коды, и «осталось» по ним было бы враньём: остаток — это коды
 * всех гостей, поэтому они считаются в контуре заведения.
 */
@Injectable()
export class GuestPromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
  ) {}

  async list(): Promise<PromoCertificate[]> {
    const guestId = currentGuestId()
    const now = new Date()

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
          schedule: true,
          limits: true,
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

    // Вне окна — как выключенное: не показываем.
    const open = offers
      .map((offer) => ({ offer, terms: termsOf(offer.schedule, offer.limits) }))
      .filter(({ terms }) => promoOpen(terms, now))

    const issued = await this.issuedCounts(
      open.filter(({ terms }) => terms.limit !== null).map(({ offer }) => offer),
    )

    // Шаблон с неразборчивой наградой пропускаем, а не роняем весь список.
    return open.flatMap(({ offer, terms }): PromoCertificate[] => {
      const reward = CertificateOfferReward.safeParse(offer.reward)

      if (!reward.success) {
        return []
      }

      const claimed = claimedIds.has(offer.id)
      const left = promoLeft(terms, issued.get(offer.id) ?? 0)

      // Разошлось — не показываем; взявший видит своё «Уже у вас».
      if (left === 0 && !claimed) {
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
          claimed,
          endsAt: terms.endsAt,
          left,
        },
      ]
    })
  }

  async claim(offerId: string): Promise<ClaimedPromoCertificate> {
    const guestId = currentGuestId()
    const now = new Date()

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
        select: { id: true, tenantId: true, reward: true, schedule: true, limits: true },
      }),
    )

    const reward = offer === null ? null : CertificateOfferReward.safeParse(offer.reward)
    const terms = offer === null ? null : termsOf(offer.schedule, offer.limits)

    if (
      offer === null ||
      reward === null ||
      !reward.success ||
      terms === null ||
      !promoOpen(terms, now)
    ) {
      // 404, а не 403: по ответу не должно быть видно, что промо существует.
      // Вне окна — так же: не началось или кончилось — для гостя его нет.
      throw new NotFoundException({
        error: { code: 'PROMO_NOT_FOUND', message: 'Промо-сертификат не найден' },
      })
    }

    try {
      // Выдача идёт через общий сервис — он открывает тенантный контур сам
      // (гостю писать грант RLS не даёт). Ключ идемпотентности — один на гостя.
      const grant = await this.grants.issue({
        offerId: offer.id,
        guestId,
        tenantId: offer.tenantId,
        validityDays: reward.data.validityDays,
        idempotencyKey: `promo:${offer.id}:${guestId}`,
        now,
        totalQty: terms.limit,
      })

      return { offerId: offer.id, code: grant.code, expiresAt: grant.expiresAt.toISOString() }
    } catch (error) {
      if (error instanceof OfferSoldOutError) {
        throw new ConflictException({
          error: { code: 'PROMO_SOLD_OUT', message: 'Сертификаты закончились' },
        })
      }

      throw error
    }
  }

  /** Сколько выдано по каждому шаблону с тиражом — в контуре его заведения. */
  private async issuedCounts(
    offers: ReadonlyArray<{ id: string; tenantId: string }>,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    const byTenant = new Map<string, string[]>()

    for (const offer of offers) {
      byTenant.set(offer.tenantId, [...(byTenant.get(offer.tenantId) ?? []), offer.id])
    }

    for (const [tenantId, ids] of byTenant) {
      const rows = await this.prisma.forTenant(tenantId, async (tx) =>
        tx.offerGrant.groupBy({
          by: ['offerId'],
          where: { tenantId, offerId: { in: ids } },
          _count: { _all: true },
        }),
      )

      for (const row of rows) {
        counts.set(row.offerId, row._count._all)
      }
    }

    return counts
  }
}
