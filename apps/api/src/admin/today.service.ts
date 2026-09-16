import { Injectable, NotFoundException } from '@nestjs/common'
import type { AdminToday } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { toNumber } from './dashboard.service'
import { setupChecklist } from './setup-checklist'

/**
 * «Сегодня» на главной бэк-офиса. docs/02, раздел 5.1.2 · docs/11, У11.
 *
 * ПРАВИЛА — КАК В ОТЧЁТЕ «ОПЕРАЦИИ» (reports.service.ts): чек — это начисление по чеку,
 * отменённый чек — начисление с компенсацией, выручка — база начисления, то есть
 * заплаченное деньгами. Цифры «сегодня» и отчёт за неделю обязаны сходиться.
 *
 * СУТКИ — ПО ЧАСАМ ЗАВЕДЕНИЯ, с двойным `AT TIME ZONE` над колонками без зоны
 * (объяснение — в шапке dashboard.service.ts).
 */

interface TodayRow {
  date: string
  revenue: unknown
  purchases: unknown
  buyers: unknown
  earned: unknown
  redeemed: unknown
  voided: unknown
  newGuests: unknown
  totalGuests: unknown
}

@Injectable()
export class TodayService {
  constructor(private readonly prisma: PrismaService) {}

  async today(): Promise<AdminToday> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true, settings: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const zone = tenant.timezone

      const [rows, cashiers, offers, channels] = await Promise.all([
        tx.$queryRaw<TodayRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})                     AS day_start,
              date_trunc('day', now() AT TIME ZONE ${zone}) + interval '1 day'  AS day_end
          ),
          entries AS (
            SELECT
              l.type,
              l.amount,
              l."basisAmount",
              l."membershipId",
              EXISTS (
                SELECT 1 FROM "LedgerEntry" r
                WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
              ) AS reversed
            FROM "LedgerEntry" l, bounds b
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type IN ('EARN', 'REDEEM')
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.day_start
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.day_end
          )
          SELECT
            (SELECT to_char(b.day_start, 'YYYY-MM-DD') FROM bounds b)                                 AS "date",
            coalesce(sum(e."basisAmount") FILTER (WHERE e.type = 'EARN' AND NOT e.reversed), 0)       AS "revenue",
            count(*) FILTER (WHERE e.type = 'EARN' AND NOT e.reversed)                               AS "purchases",
            count(DISTINCT e."membershipId") FILTER (WHERE e.type = 'EARN' AND NOT e.reversed)       AS "buyers",
            coalesce(sum(e.amount) FILTER (WHERE e.type = 'EARN' AND NOT e.reversed), 0)             AS "earned",
            coalesce(-sum(e.amount) FILTER (WHERE e.type = 'REDEEM' AND NOT e.reversed), 0)          AS "redeemed",
            count(*) FILTER (WHERE e.type = 'EARN' AND e.reversed)                                   AS "voided",
            (SELECT count(*) FROM "Membership" m, bounds b
              WHERE m."tenantId" = ${tenantId}::text
                AND (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.day_start
                AND (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.day_end)              AS "newGuests",
            (SELECT count(*) FROM "Membership" m WHERE m."tenantId" = ${tenantId}::text)             AS "totalGuests"
          FROM entries e
        `,
        tx.staff.count({ where: { tenantId, role: 'CASHIER', isActive: true } }),
        tx.offer.count({
          where: {
            tenantId,
            type: { notIn: ['GOODWILL', 'GIFT_CARD'] },
            status: { in: ['LIVE', 'SCHEDULED'] },
          },
        }),
        tx.acquisitionChannel.count({ where: { tenantId, isActive: true } }),
      ])

      const row = rows[0]

      if (row === undefined) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const revenue = toNumber(row.revenue)
      const purchases = toNumber(row.purchases)

      return {
        date: row.date,
        revenue,
        purchases,
        avgCheck: purchases === 0 ? null : Math.round(revenue / purchases),
        buyers: toNumber(row.buyers),
        newGuests: toNumber(row.newGuests),
        totalGuests: toNumber(row.totalGuests),
        pointsEarned: toNumber(row.earned),
        pointsRedeemed: toNumber(row.redeemed),
        voided: toNumber(row.voided),
        setup: setupChecklist({ settings: tenant.settings, cashiers, offers, channels }),
      }
    })
  }
}
