import { Injectable, NotFoundException } from '@nestjs/common'
import type { ChannelReport, ChannelReportCounts, DashboardPeriod } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { PERIOD_DAYS, toNumber } from './dashboard.service'

/**
 * Отчёт «Источники»: сколько гостей, покупателей и выручки принёс каждый источник.
 * docs/02, раздел 5.9 · docs/11, У7.
 *
 * ТРИ ЧИСЛА ЗА ПЕРИОД, И У КАЖДОГО СВОЯ ДАТА.
 * - Гости — вступили за период (дата участия).
 * - Покупатели — впервые купили за период (первый визит). Вступивший в прошлом
 *   месяце и купивший в этом — покупатель этого месяца: табличка сработала сейчас.
 * - Выручка — чеки за период (время чека, а не когда мы о нём узнали), без отменённых.
 *
 * Сырой SQL и местное время — по тем же причинам, что в дашборде (dashboard.service.ts):
 * агрегаты по журналу в одном запросе и границы суток по часам заведения.
 *
 * Гости без источника — отдельной строкой: без неё владелец не поймёт, какая доля
 * пришла сама, и примет табличку за единственный канал.
 */

interface ReportRow {
  channelId: string | null
  guests: unknown
  buyers: unknown
  revenue: unknown
}

const ZERO: ChannelReportCounts = { guests: 0, buyers: 0, revenue: 0 }

@Injectable()
export class ChannelReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(period: DashboardPeriod): Promise<ChannelReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[period]

    const { channels, rows } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const zone = tenant.timezone

      const [channels, rows] = await Promise.all([
        tx.acquisitionChannel.findMany({
          where: { tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, code: true, isActive: true },
        }),
        tx.$queryRaw<ReportRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone})
                - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone})
                + interval '1 day'                        AS cur_end
          ),
          members AS (
            SELECT
              m.id,
              m."channelId",
              (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
                AND (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end AS joined,
              m."firstVisitAt" IS NOT NULL
                AND (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
                AND (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end AS bought
            FROM "Membership" m, bounds b
            WHERE m."tenantId" = ${tenantId}::text
          ),
          revenue AS (
            SELECT l."membershipId", sum(l."basisAmount") AS amount
            FROM "LedgerEntry" l, bounds b
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type = 'EARN'
              AND l."basisAmount" IS NOT NULL
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
              AND NOT EXISTS (
                SELECT 1 FROM "LedgerEntry" r
                WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
              )
            GROUP BY l."membershipId"
          )
          SELECT
            mb."channelId"                          AS "channelId",
            count(*) FILTER (WHERE mb.joined)       AS "guests",
            count(*) FILTER (WHERE mb.bought)       AS "buyers",
            coalesce(sum(rv.amount), 0)             AS "revenue"
          FROM members mb
          LEFT JOIN revenue rv ON rv."membershipId" = mb.id
          GROUP BY mb."channelId"
        `,
      ])

      return { channels, rows }
    })

    const counts = new Map<string | null, ChannelReportCounts>(
      rows.map((row) => [
        row.channelId,
        {
          guests: toNumber(row.guests),
          buyers: toNumber(row.buyers),
          revenue: toNumber(row.revenue),
        },
      ]),
    )

    const report = channels
      .map((channel) => ({
        channelId: channel.id,
        name: channel.name,
        code: channel.code,
        isActive: channel.isActive,
        ...(counts.get(channel.id) ?? ZERO),
      }))
      // Выручка сверху: владелец открывает отчёт, чтобы понять, что окупается.
      .sort((a, b) => b.revenue - a.revenue || b.guests - a.guests)

    return { period, channels: report, unattributed: counts.get(null) ?? ZERO }
  }
}
