import { Injectable } from '@nestjs/common'
import { offerHowTo, offerTitle } from '@positive/contracts'
import type {
  AdminOfferCard,
  AdminOfferList,
  OfferListFilter,
  OfferStatus,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Акции заведения. docs/03, раздел 4 · docs/10, раздел 5.3 · docs/02, раздел 5.3.
 *
 * Список, а не конструктор: конструктор ждёт движка правил. Но уже сейчас
 * у заведения есть акции — партнёрские, рождённые принятыми условиями, —
 * и владелец должен видеть их и то, как они работают.
 *
 * ПАРТНЁРСКАЯ АКЦИЯ — С ПОМЕТКОЙ. Её условия меняются только через партнёрство
 * (железное правило 6 в интерфейсе): рядом имя второй стороны и ссылка туда.
 *
 * ПОДАРКИ ИЗ КАРТОЧКИ ГОСТЯ (GOODWILL) ЗДЕСЬ НЕ ЖИВУТ. Десерт за долгое ожидание —
 * не кампания, и сорок таких «акций» утопили бы настоящие.
 *
 * «ВЕРНУЛОСЬ» — ЭТО ГОСТЬ, КОТОРЫЙ ПРИШЁЛ СНОВА. Чек, в котором гость погасил
 * подарок, возвращением не считается: следующий чек должен быть другим и позже
 * погашения больше чем на час. Иначе акция хвалилась бы визитом, который сама же
 * и оплатила. Отменённый чек — тоже не визит: ошибку кассира акции не засчитываем.
 */

/** Идущие первыми: владелец открывает список, чтобы понять, что работает сейчас. */
const ORDER: Readonly<Record<OfferStatus, number>> = {
  LIVE: 0,
  SCHEDULED: 1,
  PAUSED: 2,
  DRAFT: 3,
  ENDED: 4,
}

/** Больше двухсот акций у малого заведения не бывает — это уже поломка. */
const LIST_LIMIT = 200

interface ReturnedRow {
  offerId: string
  returned: number
}

interface VenueRow {
  id: string
  brandName: string
}

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: OfferListFilter, locale: string): Promise<AdminOfferList> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const offers = await tx.offer.findMany({
        where: {
          tenantId,
          type: { not: 'GOODWILL' },
          ...(filter === 'ALL' ? {} : { status: filter }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, status: true, i18n: true, createdAt: true },
      })

      if (offers.length === 0) {
        return { items: [] }
      }

      const ids = offers.map((offer) => offer.id)

      const counts = await tx.offerGrant.groupBy({
        by: ['offerId', 'state'],
        where: { tenantId, offerId: { in: ids } },
        _count: { _all: true },
      })

      const returned = await tx.$queryRaw<ReturnedRow[]>`
        SELECT g."offerId", count(DISTINCT g."guestId")::int AS returned
        FROM "OfferGrant" g
        WHERE g."tenantId" = ${tenantId}
          AND g.state = 'REDEEMED'
          AND g."offerId" = ANY(${ids}::text[])
          AND g."redeemedAt" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "LedgerEntry" l
            WHERE l."tenantId" = g."tenantId"
              AND l."guestId" = g."guestId"
              AND l.type = 'EARN'
              AND l."refType" = 'receipt'
              AND l."refId" IS DISTINCT FROM g."redeemedReceiptId"
              AND coalesce(l."occurredAt", l."createdAt") > g."redeemedAt" + interval '1 hour'
              AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = l.id)
          )
        GROUP BY g."offerId"
      `

      // Наши партнёрские акции — те, где подарок даём мы; вторая сторона —
      // заведение, где покупают. Имя — через витрину сети, не строку заведения.
      const terms = await tx.partnershipTerm.findMany({
        where: { offerId: { in: ids } },
        select: { offerId: true, partnershipId: true, triggerTenantId: true },
      })

      const venues =
        terms.length === 0
          ? []
          : await tx.$queryRaw<VenueRow[]>`SELECT id, "brandName" FROM network_venues()`

      const issued = new Map<string, number>()
      const redeemed = new Map<string, number>()

      for (const row of counts) {
        issued.set(row.offerId, (issued.get(row.offerId) ?? 0) + row._count._all)

        if (row.state === 'REDEEMED') {
          redeemed.set(row.offerId, row._count._all)
        }
      }

      const returnedBy = new Map(returned.map((row) => [row.offerId, row.returned]))
      const names = new Map(venues.map((venue) => [venue.id, venue.brandName]))
      const partnerBy = new Map(
        terms.flatMap((term) =>
          term.offerId === null
            ? []
            : [
                [
                  term.offerId,
                  {
                    partnershipId: term.partnershipId,
                    name: names.get(term.triggerTenantId) ?? null,
                  },
                ] as const,
              ],
        ),
      )

      const items: AdminOfferCard[] = offers
        .map((offer) => ({
          id: offer.id,
          status: offer.status,
          title: offerTitle(offer.i18n, locale),
          howTo: [...offerHowTo(offer.i18n, locale)],
          partner: partnerBy.get(offer.id) ?? null,
          issued: issued.get(offer.id) ?? 0,
          redeemed: redeemed.get(offer.id) ?? 0,
          returned: returnedBy.get(offer.id) ?? 0,
          createdAt: offer.createdAt.toISOString(),
        }))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status])

      return { items }
    })
  }
}
