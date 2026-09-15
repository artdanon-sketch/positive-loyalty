import { Injectable, NotFoundException } from '@nestjs/common'
import { RfmSegment } from '@positive/contracts'
import type {
  CustomersReport,
  DashboardPeriod,
  OperationsReport,
  RfmReport,
  RfmReportRow,
  StaffReport,
  StaffReportCounts,
  StaffReportRow,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { PERIOD_DAYS, toNumber } from './dashboard.service'
import { segmentOf } from './rfm'

/**
 * Отчёты заведения: клиенты, операции, RFM, сотрудники. docs/02, раздел 5.10 · docs/11, У8.
 *
 * Правила — те же, что в дашборде и отчёте по источникам (dashboard.service.ts):
 * сырой SQL для агрегатов по журналу, границы суток по часам заведения, время чека
 * `coalesce(occurredAt, createdAt)`.
 *
 * ОТМЕНЁННЫЙ ЧЕК НЕ СЧИТАЕТСЯ НИГДЕ. У каждого чека есть начисление, даже нулевое
 * (pos.service.ts), поэтому чек — это начисление по чеку, а отменённый чек —
 * начисление, у которого есть компенсация.
 *
 * ВЫРУЧКА — ТО, ЧТО ЗАПЛАЧЕНО ДЕНЬГАМИ. База начисления на кассе — сумма к оплате
 * после баллов; оплаченное баллами показывается отдельно.
 */

type Tx = Prisma.TransactionClient

interface CustomersTotalsRow {
  total: unknown
  buyers: unknown
  newGuests: unknown
  firstPurchases: unknown
  tourists: unknown
  residents: unknown
}

interface CustomersDayRow {
  date: string
  newGuests: unknown
  firstPurchases: unknown
}

interface OperationsTotalsRow {
  turnover: unknown
  purchases: unknown
  earned: unknown
  redeemed: unknown
  voided: unknown
}

interface OperationsDayRow {
  date: string
  turnover: unknown
  purchases: unknown
}

interface StaffCountsRow {
  staffId: string | null
  operations: unknown
  turnover: unknown
}

interface StaffNewGuestsRow {
  staffId: string | null
  newGuests: unknown
}

const EMPTY_STAFF: StaffReportCounts = { operations: 0, turnover: 0, newGuests: 0 }

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Клиенты: сколько всего, сколько покупали, кто пришёл за период. */
  async customers(period: DashboardPeriod): Promise<CustomersReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[period]

    const { totals, series } = await this.prisma.forTenant(tenantId, async (tx) => {
      const zone = await this.zone(tx, tenantId)

      const [totals, series] = await Promise.all([
        tx.$queryRaw<CustomersTotalsRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone})
                + interval '1 day'                        AS cur_end
          ),
          members AS (
            SELECT
              (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})    AS joined_at,
              (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) AS first_at,
              m."visitsTotal",
              g.mode
            FROM "Membership" m
            JOIN "Guest" g ON g.id = m."guestId"
            WHERE m."tenantId" = ${tenantId}::text
          )
          SELECT
            count(*)                                                                AS "total",
            count(*) FILTER (WHERE mb."visitsTotal" > 0)                            AS "buyers",
            count(*) FILTER (WHERE mb.joined_at >= b.cur_start AND mb.joined_at < b.cur_end)
                                                                                    AS "newGuests",
            count(*) FILTER (WHERE mb.first_at >= b.cur_start AND mb.first_at < b.cur_end)
                                                                                    AS "firstPurchases",
            count(*) FILTER (WHERE mb.mode = 'TOURIST')                             AS "tourists",
            count(*) FILTER (WHERE mb.mode = 'RESIDENT')                            AS "residents"
          FROM members mb, bounds b
        `,
        tx.$queryRaw<CustomersDayRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone}) AS today
          ),
          calendar AS (
            SELECT generate_series(b.cur_start, b.today, interval '1 day')::date AS day
            FROM bounds b
          ),
          members AS (
            SELECT
              (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date    AS joined_day,
              (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS first_day
            FROM "Membership" m
            WHERE m."tenantId" = ${tenantId}::text
          )
          SELECT
            to_char(c.day, 'YYYY-MM-DD')                                  AS "date",
            (SELECT count(*) FROM members mb WHERE mb.joined_day = c.day) AS "newGuests",
            (SELECT count(*) FROM members mb WHERE mb.first_day = c.day)  AS "firstPurchases"
          FROM calendar c
          ORDER BY c.day
        `,
      ])

      return { totals: totals[0], series }
    })

    const total = toNumber(totals?.total)
    const buyers = toNumber(totals?.buyers)

    return {
      period,
      total,
      buyers,
      // Одна десятая процента: «33,3%» честнее «33%», а сотые — уже шум.
      buyersPct: total === 0 ? null : Math.round((buyers / total) * 1000) / 10,
      newGuests: toNumber(totals?.newGuests),
      firstPurchases: toNumber(totals?.firstPurchases),
      tourists: toNumber(totals?.tourists),
      residents: toNumber(totals?.residents),
      series: series.map((row) => ({
        date: row.date,
        newGuests: toNumber(row.newGuests),
        firstPurchases: toNumber(row.firstPurchases),
      })),
    }
  }

  /** Операции: выручка, покупки, баллы и отмены за период. */
  async operations(period: DashboardPeriod): Promise<OperationsReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[period]

    const { totals, series } = await this.prisma.forTenant(tenantId, async (tx) => {
      const zone = await this.zone(tx, tenantId)

      const [totals, series] = await Promise.all([
        tx.$queryRaw<OperationsTotalsRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone})
                + interval '1 day'                        AS cur_end
          ),
          entries AS (
            SELECT
              l.type,
              l.amount,
              l."basisAmount",
              EXISTS (
                SELECT 1 FROM "LedgerEntry" r
                WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
              ) AS reversed
            FROM "LedgerEntry" l, bounds b
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type IN ('EARN', 'REDEEM')
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
          )
          SELECT
            coalesce(sum(e."basisAmount") FILTER (WHERE e.type = 'EARN' AND NOT e.reversed), 0) AS "turnover",
            count(*) FILTER (WHERE e.type = 'EARN' AND NOT e.reversed)                         AS "purchases",
            coalesce(sum(e.amount) FILTER (WHERE e.type = 'EARN' AND NOT e.reversed), 0)       AS "earned",
            coalesce(-sum(e.amount) FILTER (WHERE e.type = 'REDEEM' AND NOT e.reversed), 0)    AS "redeemed",
            count(*) FILTER (WHERE e.type = 'EARN' AND e.reversed)                             AS "voided"
          FROM entries e
        `,
        tx.$queryRaw<OperationsDayRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone}) AS today
          ),
          calendar AS (
            SELECT generate_series(b.cur_start, b.today, interval '1 day')::date AS day
            FROM bounds b
          ),
          checks AS (
            SELECT
              (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS day,
              l."basisAmount"
            FROM "LedgerEntry" l
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type = 'EARN'
              AND NOT EXISTS (
                SELECT 1 FROM "LedgerEntry" r
                WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
              )
          )
          SELECT
            to_char(c.day, 'YYYY-MM-DD')          AS "date",
            coalesce(sum(ch."basisAmount"), 0)    AS "turnover",
            count(ch.day)                         AS "purchases"
          FROM calendar c
          LEFT JOIN checks ch ON ch.day = c.day
          GROUP BY c.day
          ORDER BY c.day
        `,
      ])

      return { totals: totals[0], series }
    })

    const turnover = toNumber(totals?.turnover)
    const purchases = toNumber(totals?.purchases)

    return {
      period,
      turnover,
      purchases,
      averageCheck: purchases === 0 ? null : Math.floor(turnover / purchases),
      earned: toNumber(totals?.earned),
      redeemed: toNumber(totals?.redeemed),
      voided: toNumber(totals?.voided),
      series: series.map((row) => ({
        date: row.date,
        turnover: toNumber(row.turnover),
        purchases: toNumber(row.purchases),
      })),
    }
  }

  /** RFM: десять сегментов покупателей на сегодня. Без периода — сегмент и есть срез «сейчас». */
  async rfm(): Promise<RfmReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    const buyers = await this.prisma.forTenant(tenantId, async (tx) => this.buyers(tx, tenantId))

    const rows = new Map<RfmSegment, { guests: number; purchases: number; turnover: number }>(
      RfmSegment.options.map((segment) => [segment, { guests: 0, purchases: 0, turnover: 0 }]),
    )

    for (const buyer of buyers) {
      const row = rows.get(segmentOf(buyer, now))

      if (row !== undefined) {
        row.guests += 1
        row.purchases += buyer.visitsTotal
        row.turnover += buyer.spentTotal
      }
    }

    const segments: RfmReportRow[] = RfmSegment.options.map((segment) => {
      const row = rows.get(segment) ?? { guests: 0, purchases: 0, turnover: 0 }

      return {
        segment,
        guests: row.guests,
        purchases: row.purchases,
        averageCheck: row.purchases === 0 ? null : Math.floor(row.turnover / row.purchases),
        turnover: row.turnover,
      }
    })

    return { buyers: buyers.length, segments }
  }

  /**
   * Участия в сегменте — для фильтра списка гостей и выгрузки: сегмент в отчёте
   * кликается и открывает ровно этих гостей. Внутри транзакции вызывающего.
   */
  async membershipIdsIn(tx: Tx, tenantId: string, segment: RfmSegment): Promise<string[]> {
    const now = new Date()
    const buyers = await this.buyers(tx, tenantId)

    return buyers.filter((buyer) => segmentOf(buyer, now) === segment).map((buyer) => buyer.id)
  }

  /** Сотрудники: чеки, выручка и новые гости по тому, кто провёл чек. */
  async staff(period: DashboardPeriod): Promise<StaffReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[period]

    const { counts, firsts, people } = await this.prisma.forTenant(tenantId, async (tx) => {
      const zone = await this.zone(tx, tenantId)

      const [counts, firsts] = await Promise.all([
        tx.$queryRaw<StaffCountsRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone})
                + interval '1 day'                        AS cur_end
          )
          SELECT
            CASE WHEN l."actorType" IN ('STAFF', 'OWNER') THEN l."actorId" END AS "staffId",
            count(*)                                                          AS "operations",
            coalesce(sum(l."basisAmount"), 0)                                 AS "turnover"
          FROM "LedgerEntry" l, bounds b
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
            AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
            AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
            AND NOT EXISTS (
              SELECT 1 FROM "LedgerEntry" r
              WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
            )
          GROUP BY 1
        `,
        // Новый гость сотрудника — тот, чей ПЕРВЫЙ неотменённый чек в заведении провёл
        // этот сотрудник, и этот чек пришёлся на период.
        tx.$queryRaw<StaffNewGuestsRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone})
                + interval '1 day'                        AS cur_end
          ),
          firsts AS (
            SELECT DISTINCT ON (l."membershipId")
              l."actorType",
              l."actorId",
              (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) AS local_at
            FROM "LedgerEntry" l
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type = 'EARN'
              AND NOT EXISTS (
                SELECT 1 FROM "LedgerEntry" r
                WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
              )
            ORDER BY l."membershipId", coalesce(l."occurredAt", l."createdAt"), l.id
          )
          SELECT
            CASE WHEN f."actorType" IN ('STAFF', 'OWNER') THEN f."actorId" END AS "staffId",
            count(*)                                                          AS "newGuests"
          FROM firsts f, bounds b
          WHERE f.local_at >= b.cur_start AND f.local_at < b.cur_end
          GROUP BY 1
        `,
      ])

      const ids = [
        ...new Set(
          [...counts, ...firsts].flatMap((row) => (row.staffId === null ? [] : [row.staffId])),
        ),
      ]

      const people =
        ids.length === 0
          ? []
          : await tx.staff.findMany({
              where: { tenantId, id: { in: ids } },
              select: { id: true, displayName: true, role: true, isActive: true },
            })

      return { counts, firsts, people }
    })

    const byStaff = new Map<string | null, StaffReportCounts>()
    const known = new Map(people.map((person) => [person.id, person]))
    // Сотрудник, которого нет в заведении (удалён или чужой), — в строку «система»:
    // его чеки не должны пропасть из итога.
    const keyOf = (staffId: string | null): string | null =>
      staffId !== null && known.has(staffId) ? staffId : null
    const bucket = (key: string | null): StaffReportCounts => {
      const current = byStaff.get(key) ?? { ...EMPTY_STAFF }
      byStaff.set(key, current)
      return current
    }

    for (const row of counts) {
      const current = bucket(keyOf(row.staffId))
      current.operations += toNumber(row.operations)
      current.turnover += toNumber(row.turnover)
    }

    for (const row of firsts) {
      bucket(keyOf(row.staffId)).newGuests += toNumber(row.newGuests)
    }

    const staff: StaffReportRow[] = people
      .flatMap((person): StaffReportRow[] => {
        const numbers = byStaff.get(person.id)

        if (
          numbers === undefined ||
          (person.role !== 'CASHIER' && person.role !== 'MANAGER' && person.role !== 'OWNER')
        ) {
          return []
        }

        return [
          {
            staffId: person.id,
            displayName: person.displayName,
            role: person.role,
            isActive: person.isActive,
            ...numbers,
          },
        ]
      })
      .sort((a, b) => b.turnover - a.turnover || b.operations - a.operations)

    return { period, staff, system: byStaff.get(null) ?? { ...EMPTY_STAFF } }
  }

  /** Покупатели заведения — те, у кого был хоть один визит. */
  private async buyers(
    tx: Tx,
    tenantId: string,
  ): Promise<Array<{ id: string; lastVisitAt: Date; visitsTotal: number; spentTotal: number }>> {
    const rows = await tx.membership.findMany({
      where: { tenantId, visitsTotal: { gt: 0 }, lastVisitAt: { not: null } },
      select: { id: true, lastVisitAt: true, visitsTotal: true, spentTotal: true },
    })

    return rows.flatMap((row) =>
      row.lastVisitAt === null ? [] : [{ ...row, lastVisitAt: row.lastVisitAt }],
    )
  }

  private async zone(tx: Tx, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { timezone: true },
    })

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return tenant.timezone
  }
}
