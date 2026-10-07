import { ForbiddenException, Injectable } from '@nestjs/common'
import { parseProgramConfig } from '@positive/contracts'
import type {
  PosHistory,
  PosHistoryQuery,
  PosInvite,
  PosMe,
  PosStats,
  ProgramConfig,
} from '@positive/contracts'

import { getEnv } from '../common/config/env'
import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { Prisma } from '../generated/prisma/client'

/**
 * Приложение кассира сверх «Счёта»: пригласить, история, профиль.
 * docs/02, раздел 3.9.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ СЕРВИС. `PosService` отвечает за деньги: предрасчёт, чек,
 * отмену. Эти три метода денег не трогают и ничего не меняют — им нечего
 * делать рядом с журналом, а `PosService` и так вырос.
 *
 * ГРАНИЦА ВИДИМОСТИ — НАСТРОЙКА ВЛАДЕЛЬЦА, А НЕ РОЛЬ. История смены и
 * показатели закрыты по умолчанию: это выручка заведения, разложенная по часам.
 * Владелец открывает их в бэк-офисе, зная свою команду. Проверка стоит здесь,
 * на сервере: спрятать вкладку на экране — удобство, а не защита.
 *
 * ТОЛЬКО СВОИ ОПЕРАЦИИ. Даже с открытой историей кассир видит лишь то, что
 * провёл сам: чужая смена не его дело, и сравнивать себя с соседом по кассе
 * он будет не здесь.
 *
 * ЧЕК СЧИТАЕТСЯ ТАК ЖЕ, КАК В ОТЧЁТАХ ВЛАДЕЛЬЦА (today.service.ts): чек —
 * начисление по чеку, отменённый чек — начисление с компенсацией, выручка —
 * база начисления. Кассир, сверяющий смену с владельцем, обязан увидеть
 * те же цифры.
 */

/** Средняя оценка считается за это окно: месяц — достаточно свежо и не пусто. */
const RATING_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Сколько чеков отдаём списком. Итог считается по всему периоду, а не по списку. */
const HISTORY_LIMIT = 200

/** Период по календарю заведения: даты ГГГГ-ММ-ДД, обе включительно. */
interface LocalPeriod {
  readonly from: string
  readonly to: string
}

interface CheckRow {
  id: string
  occurredAt: string
  guest: string | null
  basisAmount: number | null
  amount: number
  reversed: boolean
}

interface TotalsRow {
  total: bigint
  count: bigint
}

/** Сегодняшняя дата по часам заведения. */
const localDate = (timezone: string, at: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

/** Дата на `days` дней раньше. Календарная арифметика: переход на летнее время её не сдвигает. */
const daysBefore = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() - days)
  return shifted.toISOString().slice(0, 10)
}

const localPeriod = (query: PosHistoryQuery, timezone: string): LocalPeriod => {
  if (query.period === 'range' && query.from !== undefined && query.to !== undefined) {
    return { from: query.from, to: query.to }
  }

  const today = localDate(timezone, new Date())
  const back = query.period === 'week' ? 6 : query.period === 'month' ? 29 : 0

  return { from: daysBefore(today, back), to: today }
}

/**
 * Чеки сотрудника за период. Одно определение на список, итог и профиль:
 * «история» и «смена» не разойдутся в счёте.
 *
 * Время чека — coalesce(occurredAt, createdAt): чек, долежавший в очереди
 * планшета без связи, ложится в час, когда его пробили, а не когда он дошёл.
 * Двойной AT TIME ZONE — объяснение в шапке dashboard.service.ts.
 */
const ownChecks = (
  tenantId: string,
  actorId: string,
  timezone: string,
  period: LocalPeriod,
): Prisma.Sql => Prisma.sql`
  SELECT
    l.id,
    l."guestId",
    l.amount,
    l."basisAmount",
    coalesce(l."occurredAt", l."createdAt") AS at,
    EXISTS (
      SELECT 1 FROM "LedgerEntry" r
      WHERE r."tenantId" = ${tenantId}::text AND r."reversalOfId" = l.id
    ) AS reversed
  FROM "LedgerEntry" l
  WHERE l."tenantId" = ${tenantId}::text
    AND l."actorId" = ${actorId}::text
    AND l."actorType" IN ('STAFF', 'OWNER')
    AND l.type = 'EARN'
    AND l."refType" = 'receipt'
    AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})
      >= ${period.from}::date
    AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})
      < ${period.to}::date + 1
`

/** Итог и число чеков без отменённых. */
const checkTotals = async (
  tx: Prisma.TransactionClient,
  checks: Prisma.Sql,
): Promise<{ total: number; count: number }> => {
  const rows = await tx.$queryRaw<TotalsRow[]>`
    WITH checks AS (${checks})
    SELECT
      coalesce(sum(c."basisAmount") FILTER (WHERE NOT c.reversed), 0)::bigint AS total,
      count(*) FILTER (WHERE NOT c.reversed)                                  AS count
    FROM checks c
  `
  const row = rows[0]

  return {
    total: row === undefined ? 0 : Number(row.total),
    count: row === undefined ? 0 : Number(row.count),
  }
}

@Injectable()
export class PosAppService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Что показать гостю, чтобы записать его прямо у стойки.
   *
   * Берём первый включённый источник заведения и отдаём его НАЗВАНИЕ вместе с
   * кодом: кассир должен видеть, куда запишется гость. Без этого заведение
   * однажды обнаружит, что все гости со стойки числятся пришедшими из Instagram.
   */
  async invite(): Promise<PosInvite> {
    const { tenantId } = TenantContext.getOrThrow()
    const { rules } = await this.venue(tenantId)

    if (!rules.allowInvite) {
      throw new ForbiddenException({
        error: { code: 'FORBIDDEN', message: 'Приглашение гостей с кассы выключено в настройках' },
      })
    }

    const channel = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.acquisitionChannel.findFirst({
        where: { tenantId, isActive: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { code: true, name: true },
      }),
    )

    if (channel === null) {
      // Источников нет — показывать нечего. Пустой ответ честнее выдуманного
      // кода: по такому QR гость получил бы отказ у стойки.
      return { code: null, url: null, source: null }
    }

    const base = getEnv().guestAppUrl

    return {
      code: channel.code,
      source: channel.name,
      url:
        base === ''
          ? null
          : `${base}/?venue=${encodeURIComponent(tenantId)}&src=${encodeURIComponent(channel.code)}`,
    }
  }

  /** Свои чеки за период с итогом суммой — как в подвале у UDS. */
  async history(query: PosHistoryQuery): Promise<PosHistory> {
    const { tenantId, actorId } = TenantContext.getOrThrow()
    const { rules, timezone } = await this.venue(tenantId)

    if (!rules.showOwnHistory) {
      throw new ForbiddenException({
        error: { code: 'FORBIDDEN', message: 'История смены выключена в настройках' },
      })
    }

    if (actorId === null) {
      // Сессия без сотрудника: показывать «свои» операции некому.
      return { items: [], total: 0, count: 0, hasMore: false }
    }

    const checks = ownChecks(tenantId, actorId, timezone, localPeriod(query, timezone))

    const { rows, totals } = await this.prisma.forTenant(tenantId, async (tx) => ({
      // На одну строку больше, чем показываем: так видно, есть ли что-то старше.
      rows: await tx.$queryRaw<CheckRow[]>`
        WITH checks AS (${checks})
        SELECT
          c.id,
          to_char(c.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
          g."displayName"                                 AS guest,
          c."basisAmount",
          c.amount,
          c.reversed
        FROM checks c
        JOIN "Guest" g ON g.id = c."guestId"
        ORDER BY c.at DESC, c.id DESC
        LIMIT ${HISTORY_LIMIT + 1}::int
      `,
      totals: await checkTotals(tx, checks),
    }))

    return {
      items: rows.slice(0, HISTORY_LIMIT).map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        guest: row.guest,
        amount: row.basisAmount ?? 0,
        points: row.amount,
        reversed: row.reversed,
      })),
      total: totals.total,
      count: totals.count,
      hasMore: rows.length > HISTORY_LIMIT,
    }
  }

  /** Кто я и где работаю. Показатели — только если владелец их открыл. */
  async me(): Promise<PosMe> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()
    const { rules, timezone, brandName } = await this.venue(tenantId)

    const staff =
      actorId === null
        ? null
        : await this.prisma.forTenant(tenantId, async (tx) =>
            tx.staff.findFirst({
              where: { id: actorId, tenantId },
              select: { displayName: true },
            }),
          )

    const safeRole = role === 'CASHIER' || role === 'MANAGER' || role === 'OWNER' ? role : 'CASHIER'

    return {
      displayName: staff?.displayName ?? '',
      role: safeRole,
      venue: brandName,
      stats: rules.showOwnStats ? await this.stats(tenantId, actorId, timezone) : null,
    }
  }

  /** Выручка сегодняшней смены и средняя оценка гостей за месяц. */
  private async stats(
    tenantId: string,
    actorId: string | null,
    timezone: string,
  ): Promise<PosStats> {
    if (actorId === null) {
      return { shiftRevenue: 0, shiftCount: 0, rating: null }
    }

    const today = localDate(timezone, new Date())
    const checks = ownChecks(tenantId, actorId, timezone, { from: today, to: today })
    const since = new Date(Date.now() - RATING_WINDOW_DAYS * DAY_MS)

    return this.prisma.forTenant(tenantId, async (tx) => {
      const shift = await checkTotals(tx, checks)

      const reviews = await tx.review.aggregate({
        where: { tenantId, staffId: actorId, createdAt: { gte: since } },
        _avg: { rating: true },
      })

      const average = reviews._avg.rating

      return {
        shiftRevenue: shift.total,
        shiftCount: shift.count,
        // Десятая доля — как в отчёте «Сотрудники»: «4,7» читается, «4,6666» нет.
        rating: average === null ? null : Math.round(average * 10) / 10,
      }
    })
  }

  /** Правила кассы, часовой пояс и вывеска — одним чтением. */
  private async venue(tenantId: string): Promise<{
    rules: ProgramConfig['cashierRules']
    timezone: string
    brandName: string
  }> {
    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true, timezone: true, brandName: true },
      }),
    )

    return {
      rules: parseProgramConfig(tenant?.settings).cashierRules,
      timezone: tenant?.timezone ?? 'Asia/Bangkok',
      brandName: tenant?.brandName ?? '',
    }
  }
}
