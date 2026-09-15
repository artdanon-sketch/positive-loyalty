import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { engineOfferTexts, offerHowTo, offerTitle } from '@positive/contracts'
import type {
  AdminOfferCard,
  AdminOfferList,
  CreateOfferInput,
  OfferChangeResult,
  OfferListFilter,
  OfferSimulation,
  OfferStatus,
  SimulateOfferInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import { SIMULATION_DAYS, simulateOffer } from '../rules/simulate'
import {
  decideTransition,
  effectiveStatus,
  OFFER_EXPIRED_MESSAGE,
  offerActions,
} from './offer-lifecycle'
import type { OfferAction } from './offer-lifecycle'

/**
 * Акции заведения: список, конструктор, запуск и пауза, прогноз.
 * docs/03, раздел 4 · docs/10, раздел 5.3 · docs/02, раздел 5.3 · docs/11, У2.
 *
 * КОНСТРУКТОР ПИШЕТ ТЕ ЖЕ ПРАВИЛА, ЧТО ЧИТАЕТ КАССА. Отдельного «формата
 * конструктора» нет: акция из бэк-офиса ложится в колонки Offer ровно так, как
 * их разбирает движок правил, — и разойтись им негде. Прогноз гоняет историю
 * через тот же движок.
 *
 * ПАРТНЁРСКАЯ АКЦИЯ — С ПОМЕТКОЙ. Её условия меняются только через партнёрство
 * (железное правило 6 в интерфейсе): рядом имя второй стороны и ссылка туда,
 * а кнопок запуска и паузы у неё нет.
 *
 * ПОДАРКИ ИЗ КАРТОЧКИ ГОСТЯ (GOODWILL) И ШАБЛОНЫ СЕРТИФИКАТОВ (GIFT_CARD) ЗДЕСЬ НЕ ЖИВУТ. Десерт за долгое ожидание —
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

/** Потолок чеков в прогнозе: у малого заведения за месяц их тысячи, а не сотни тысяч. */
const HISTORY_LIMIT = 50_000

const DAY_MS = 24 * 60 * 60 * 1000

interface ReturnedRow {
  offerId: string
  returned: number
}

interface VenueRow {
  id: string
  brandName: string
}

interface HistoryRow {
  guestId: string
  amount: number
  at: Date
  previousVisitAt: Date | null
  mode: string
  isControlGroup: boolean
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: OfferListFilter, locale: string): Promise<AdminOfferList> {
    const { tenantId, role } = TenantContext.getOrThrow()
    const now = new Date()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.offer.findMany({
        where: { tenantId, type: { notIn: ['GOODWILL', 'GIFT_CARD'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: { id: true, type: true, status: true, schedule: true, i18n: true, createdAt: true },
      })

      // Фильтр — по статусу, который видит владелец, а он зависит от дат.
      // Поэтому в памяти, а не в запросе: строк здесь не больше двухсот.
      const offers = rows
        .map((offer) => ({ ...offer, shown: effectiveStatus(offer, now) }))
        .filter((offer) => filter === 'ALL' || offer.shown === filter)

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
        .map((offer) => {
          const partner = partnerBy.get(offer.id) ?? null

          return {
            id: offer.id,
            status: offer.shown,
            title: offerTitle(offer.i18n, locale),
            howTo: [...offerHowTo(offer.i18n, locale)],
            partner,
            issued: issued.get(offer.id) ?? 0,
            redeemed: redeemed.get(offer.id) ?? 0,
            returned: returnedBy.get(offer.id) ?? 0,
            actions: offerActions(
              {
                status: offer.status,
                type: offer.type,
                schedule: offer.schedule,
                isPartner: partner !== null,
              },
              role,
              now,
            ),
            createdAt: offer.createdAt.toISOString(),
          }
        })
        .sort((a, b) => ORDER[a.status] - ORDER[b.status])

      return { items }
    })
  }

  /**
   * Собрать акцию. Только владелец — гвард на контроллере.
   *
   * Шаги «как воспользоваться» пишет сервер, а не экран: их же увидят гость
   * в кошельке и кассир при погашении, и на двух языках они не должны разойтись.
   */
  async create(input: CreateOfferInput): Promise<OfferChangeResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()
    const now = new Date()
    const status: OfferStatus = input.launch === 'NOW' ? 'LIVE' : 'DRAFT'

    if (
      status === 'LIVE' &&
      effectiveStatus({ status, schedule: input.schedule }, now) === 'ENDED'
    ) {
      throw new ConflictException({
        error: { code: 'OFFER_EXPIRED', message: OFFER_EXPIRED_MESSAGE },
      })
    }

    const offer = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offer.create({
        data: {
          tenantId,
          type: input.type,
          status,
          priority: input.priority,
          stackable: input.stackable,
          visibility: 'VENUE_ONLY',
          audience: input.audience,
          schedule: input.schedule,
          limits: input.limits,
          reward: input.reward,
          i18n: engineOfferTexts({
            title: input.title,
            reward: input.reward,
            limits: input.limits,
          }),
        },
        select: { id: true },
      }),
    )

    await this.audit.write({
      action: 'OFFER_CREATED',
      actorType: 'OWNER',
      actorId,
      tenantId,
      entityType: 'Offer',
      entityId: offer.id,
      newValue: {
        type: input.type,
        title: input.title,
        status,
        audience: input.audience,
        schedule: input.schedule,
        limits: input.limits,
        reward: input.reward,
      },
      requestId,
    })

    return { id: offer.id, status: effectiveStatus({ status, schedule: input.schedule }, now) }
  }

  /** Запустить, поставить на паузу или завершить. Решение — в offer-lifecycle. */
  async transition(offerId: string, action: OfferAction): Promise<OfferChangeResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()
    const now = new Date()

    const change = await this.prisma.forTenant(tenantId, async (tx) => {
      const offer = await tx.offer.findFirst({
        where: { id: offerId, tenantId, type: { notIn: ['GOODWILL', 'GIFT_CARD'] } },
        select: {
          id: true,
          type: true,
          status: true,
          schedule: true,
          partnershipTerm: { select: { id: true } },
        },
      })

      if (offer === null) {
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Акция не найдена' } })
      }

      const verdict = decideTransition(
        {
          status: offer.status,
          type: offer.type,
          schedule: offer.schedule,
          isPartner: offer.partnershipTerm !== null,
        },
        action,
        now,
      )

      if (verdict.kind === 'REFUSE') {
        throw new ConflictException({ error: { code: verdict.code, message: verdict.message } })
      }

      if (verdict.kind === 'SAME') {
        return { from: offer.status, to: offer.status, schedule: offer.schedule }
      }

      // Условная запись: если статус успели сменить параллельно, вторая смена
      // не перетирает первую молча.
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, tenantId, status: offer.status },
        data: { status: verdict.to },
      })

      if (updated.count === 0) {
        throw new ConflictException({
          error: {
            code: 'INVALID_TRANSITION',
            message: 'Акцию только что изменили — обновите список',
          },
        })
      }

      return { from: offer.status, to: verdict.to, schedule: offer.schedule }
    })

    // Повтор нажатия ничего не меняет — и в аудите следа не оставляет.
    if (change.from !== change.to) {
      await this.audit.write({
        action: 'OFFER_STATUS_CHANGED',
        actorType: 'OWNER',
        actorId,
        tenantId,
        entityType: 'Offer',
        entityId: offerId,
        oldValue: { status: change.from },
        newValue: { status: change.to, action },
        requestId,
      })
    }

    return {
      id: offerId,
      status: effectiveStatus({ status: change.to, schedule: change.schedule }, now),
    }
  }

  /**
   * Прогноз «если бы эта акция шла последние 30 дней». Считает rules/simulate;
   * здесь — только история заведения.
   *
   * Чек в истории — начисление за чек, которое не отменили: отменённый чек
   * не был визитом. Предыдущий визит считается по всей истории гостя в заведении,
   * а не только по окну — иначе «спящий» гость в начале окна выглядел бы новым.
   */
  async simulate(input: SimulateOfferInput): Promise<OfferSimulation> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()
    const since = new Date(now.getTime() - SIMULATION_DAYS * DAY_MS)

    return this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true },
      })

      const started = await tx.$queryRaw<Array<{ startedAt: Date | null }>>`
        SELECT min(coalesce(l."occurredAt", l."createdAt")) AS "startedAt"
        FROM "LedgerEntry" l
        WHERE l."tenantId" = ${tenantId}
          AND l.type = 'EARN'
          AND l."refType" = 'receipt'
      `

      const rows = await tx.$queryRaw<HistoryRow[]>`
        WITH visits AS (
          SELECT l."guestId", l."membershipId", l."basisAmount" AS amount,
                 coalesce(l."occurredAt", l."createdAt") AS at
          FROM "LedgerEntry" l
          WHERE l."tenantId" = ${tenantId}
            AND l.type = 'EARN'
            AND l."refType" = 'receipt'
            AND l."basisAmount" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = l.id)
        ),
        ordered AS (
          SELECT v.*, lag(v.at) OVER (PARTITION BY v."membershipId" ORDER BY v.at) AS "previousVisitAt"
          FROM visits v
        )
        SELECT o."guestId", o.amount, o.at, o."previousVisitAt",
               g.mode::text AS mode, m."isControlGroup"
        FROM ordered o
        JOIN "Membership" m ON m.id = o."membershipId"
        JOIN "Guest" g ON g.id = o."guestId"
        WHERE o.at >= ${since} AND o.at <= ${now}
        ORDER BY o.at
        LIMIT ${HISTORY_LIMIT}
      `

      return simulateOffer({
        offer: input,
        checks: rows.map((row) => ({
          guestId: row.guestId,
          amount: row.amount,
          at: row.at,
          mode: row.mode === 'RESIDENT' ? 'RESIDENT' : 'TOURIST',
          isControlGroup: row.isControlGroup,
          isFirstVisit: row.previousVisitAt === null,
          previousVisitAt: row.previousVisitAt,
        })),
        historyStartedAt: started[0]?.startedAt ?? null,
        now,
        timezone: tenant?.timezone ?? 'Asia/Bangkok',
      })
    })
  }
}
