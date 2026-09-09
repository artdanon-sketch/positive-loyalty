import { Injectable } from '@nestjs/common'
import type { PlatformTenantRow, PlatformTenantsResult } from '@positive/contracts'

import { PlatformPrismaService } from './platform-prisma.service'

/**
 * Цифры по всем заведениям сразу — то, ради чего панель и заводилась.
 *
 * ─── ОДИН ЗАПРОС, А НЕ ПО ЗАВЕДЕНИЮ ЗА РАЗ ──────────────────────────────────
 *
 * Соблазн простой: взять список заведений, а потом в цикле спросить статистику
 * по каждому. На трёх заведениях разницы не видно, на сотне это сто запросов
 * вместо одного, и экран начинает думать секундами.
 *
 * Хуже другое: такой цикл разъезжается во времени. Первое заведение посчитано
 * в одну секунду, сотое — в другую, и сумма внизу не сходится со слагаемыми.
 * Владелец платформы увидит несходящийся отчёт и перестанет верить панели.
 *
 * ─── ПОЧЕМУ СЫРОЙ SQL, А НЕ ЗАПРОС ЧЕРЕЗ PRISMA ─────────────────────────────
 *
 * Нужны агрегаты с LEFT JOIN и подзапросом за окно в тридцать дней. Prisma
 * такое выражает через groupBy, который не умеет соединения, — пришлось бы
 * собирать из трёх запросов и склеивать в памяти. Одним SQL это честнее
 * и заведомо согласовано во времени.
 *
 * ─── ЧТО ЭТОТ ЗАПРОС НЕ МОЖЕТ ПРОЧИТАТЬ ─────────────────────────────────────
 *
 * Имена и телефоны гостей — их не отдаст сама база: роль positive_platform
 * не имеет прав на эти колонки. Здесь считаются участия и суммы, а не люди.
 */
@Injectable()
export class PlatformStatsService {
  constructor(private readonly prisma: PlatformPrismaService) {}

  async tenants(now: Date): Promise<PlatformTenantsResult> {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT
        t."id",
        t."brandName",
        t."vertical"::text        AS "vertical",
        t."status"::text          AS "status",
        t."plan"::text            AS "plan",
        t."seasonMode",
        t."currency",
        t."createdAt",
        count(m."id")                                  AS "guests",
        coalesce(sum(m."spentTotal"), 0)               AS "spentTotal",
        coalesce(sum(m."pointsBalance"), 0)            AS "pointsOutstanding",
        coalesce(sum(m."visitsTotal"), 0)              AS "visits",
        max(m."lastVisitAt")                           AS "lastVisitAt",
        (
          SELECT count(*)
          FROM "LedgerEntry" le
          WHERE le."tenantId" = t."id" AND le."occurredAt" >= ${since}
        )                                              AS "operations30d"
      FROM "Tenant" t
      LEFT JOIN "Membership" m ON m."tenantId" = t."id"
      GROUP BY t."id"
      ORDER BY coalesce(sum(m."spentTotal"), 0) DESC, t."brandName" ASC
    `

    const tenants = rows.map(toRow)

    return {
      tenants,
      totals: {
        tenants: tenants.length,
        // «Платящие» сегодня определяются статусом, а не фактом платежа:
        // таблицы платежей не существует, и притворяться, что она есть, нельзя.
        paying: tenants.filter((tenant) => tenant.status === 'ACTIVE').length,
        trial: tenants.filter((tenant) => tenant.status === 'TRIAL').length,
        guests: tenants.reduce((sum, tenant) => sum + tenant.guests, 0),
        spentTotal: tenants.reduce((sum, tenant) => sum + tenant.spentTotal, 0),
      },
      asOf: now.toISOString(),
    }
  }
}

/**
 * Что отдаёт драйвер.
 *
 * count и sum в PostgreSQL — это bigint, а его драйвер приносит СТРОКОЙ, чтобы
 * не потерять точность на числах больше 2^53. Приняв это за number, получаешь
 * молчаливое «[object String]» вместо суммы. Отсюда явный тип и явное
 * приведение ниже, а не надежда на то, что «оно само».
 */
interface RawRow {
  id: string
  brandName: string
  vertical: string
  status: string
  plan: string
  seasonMode: boolean
  currency: string
  createdAt: Date
  guests: bigint | number | string
  spentTotal: bigint | number | string
  pointsOutstanding: bigint | number | string
  visits: bigint | number | string
  lastVisitAt: Date | null
  operations30d: bigint | number | string
}

/** bigint, number или строка — приводим к числу в одном месте. */
const toInt = (value: bigint | number | string): number => Number(value)

const toRow = (raw: RawRow): PlatformTenantRow => ({
  id: raw.id,
  brandName: raw.brandName,
  vertical: raw.vertical,
  status: raw.status,
  plan: raw.plan,
  seasonMode: raw.seasonMode,
  currency: raw.currency,
  createdAt: raw.createdAt.toISOString(),
  guests: toInt(raw.guests),
  spentTotal: toInt(raw.spentTotal),
  pointsOutstanding: toInt(raw.pointsOutstanding),
  visits: toInt(raw.visits),
  lastVisitAt: raw.lastVisitAt?.toISOString() ?? null,
  operations30d: toInt(raw.operations30d),
})
