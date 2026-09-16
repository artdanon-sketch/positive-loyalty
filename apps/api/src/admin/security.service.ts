import { Injectable, NotFoundException } from '@nestjs/common'
import { ProgramConfig, SecurityActorType, SuspiciousConfig } from '@positive/contracts'
import type {
  SecurityEvent,
  SecurityHistory,
  SecurityHistoryQuery,
  SuspiciousCashier,
  SuspiciousGuest,
  SuspiciousQuery,
  SuspiciousReport,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { PERIOD_DAYS, toNumber } from './dashboard.service'

/**
 * Безопасность заведения: история действий и подозрительные операции.
 * docs/02, раздел 5.13 · docs/05, разделы 6.1 и 9 · docs/11, У12.
 *
 * ИСТОРИЯ — ЧЕРЕЗ ФУНКЦИЮ БАЗЫ `tenant_audit_history` (миграции 20260916060000
 * и 20260916100000): роль приложения аудит не читает, а функция отдаёт только события
 * объявленного заведения и без значений «было / стало».
 *
 * ФИЛЬТРЫ ДНЯ И СОТРУДНИКА ТОЖЕ В ФУНКЦИИ, А НЕ НАД ЕЁ ВЫДАЧЕЙ: страница отрезается
 * внутри, и отсев снаружи оставил бы владельцу полупустые страницы.
 *
 * ПОДОЗРИТЕЛЬНОЕ СЧИТАЕТСЯ НА ЗАПРОСЕ, А НЕ ПИШЕТСЯ В РИСК-ЛОГ: риск-модуля ещё нет,
 * а экран отвечает на вопрос «что стоит посмотреть» по журналу, который уже есть.
 * Ничего не блокируется.
 *
 * СУТКИ — ПО ЧАСАМ ЗАВЕДЕНИЯ, чек — начисление по чеку (как в отчётах).
 */

/** Сколько строк в каждом списке — владельцу нужны худшие, а не все. */
const LIST_MAX = 50

/** Всплеск: не меньше стольких чеков за день… */
const BURST_MIN_RECEIPTS = 10

/** …у сотрудника, проработавшего не меньше стольких дней за три месяца. */
const BURST_MIN_DAYS = 7

/** Окно, по которому считается «обычно». */
const BURST_BASELINE_DAYS = 90

/** Роли, чей actorId — сотрудник заведения. */
const STAFF_ACTORS: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'OWNER'])

interface HistoryRow {
  id: string
  occurredAt: string
  action: string
  actorType: string
  actorId: string | null
  entityType: string | null
  entityId: string | null
  reason: string | null
}

interface GuestRow {
  membershipId: string
  day: string
  receipts: unknown
}

interface CashierRow {
  staffId: string
  day: string
  receipts: unknown
  usual?: unknown
}

@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async history(query: SecurityHistoryQuery): Promise<SecurityHistory> {
    const { tenantId } = TenantContext.getOrThrow()
    // «Сейчас» с запасом в минуту: событие, записанное в эту же секунду, не должно
    // пропасть из-за расхождения часов приложения и базы.
    const before =
      query.before === undefined ? new Date(Date.now() + 60_000) : new Date(query.before)

    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<HistoryRow[]>`
        SELECT * FROM tenant_audit_history(
          ${before}::timestamptz,
          ${query.limit}::int,
          ${query.actorId ?? null}::text,
          ${query.day ?? null}::date
        )
      `

      const staffIds = [
        ...new Set(
          rows.flatMap((row) =>
            row.actorId !== null && STAFF_ACTORS.has(row.actorType) ? [row.actorId] : [],
          ),
        ),
      ]
      const names = await this.staffNames(tx, tenantId, staffIds)

      const items = rows.map((row): SecurityEvent => {
        const actorType = SecurityActorType.safeParse(row.actorType)
        const name = row.actorId === null ? undefined : names.get(row.actorId)

        return {
          id: row.id,
          occurredAt: row.occurredAt,
          action: row.action,
          actorType: actorType.success ? actorType.data : 'SYSTEM',
          actor:
            row.actorId !== null && name !== undefined && STAFF_ACTORS.has(row.actorType)
              ? { id: row.actorId, displayName: name }
              : null,
          entityType: row.entityType,
          entityId: row.entityId,
          reason: row.reason,
        }
      })

      return {
        items,
        nextBefore: rows.length === query.limit ? (rows.at(-1)?.occurredAt ?? null) : null,
      }
    })
  }

  async suspicious(query: SuspiciousQuery): Promise<SuspiciousReport> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[query.period]

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
      const program = ProgramConfig.safeParse(tenant.settings ?? {})
      const maxChecksPerDay = program.success
        ? program.data.suspicious.maxChecksPerDay
        : SuspiciousConfig.parse({}).maxChecksPerDay

      const [guestRows, burstRows, selfRows] = await Promise.all([
        tx.$queryRaw<GuestRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone}) - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone}) + interval '1 day'                       AS cur_end
          ),
          receipts AS (
            SELECT
              l."membershipId",
              (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) AS local_at
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
            r."membershipId"                          AS "membershipId",
            to_char(r.local_at::date, 'YYYY-MM-DD')   AS "day",
            count(*)                                  AS "receipts"
          FROM receipts r, bounds b
          WHERE r.local_at >= b.cur_start AND r.local_at < b.cur_end
          GROUP BY r."membershipId", r.local_at::date
          HAVING count(*) > ${maxChecksPerDay}::int
          ORDER BY count(*) DESC, r.local_at::date DESC
          LIMIT ${LIST_MAX}::int
        `,
        // Всплеск считается по всем чекам сотрудника, отменённые тоже: серия чеков,
        // которые потом отменили, — сама по себе повод посмотреть.
        tx.$queryRaw<CashierRow[]>`
          WITH bounds AS (
            SELECT
              (date_trunc('day', now() AT TIME ZONE ${zone}) - make_interval(days => ${days}::int - 1))::date AS cur_start,
              (date_trunc('day', now() AT TIME ZONE ${zone}) - make_interval(days => ${BURST_BASELINE_DAYS}::int - 1))::date AS base_start
          ),
          daily AS (
            SELECT
              l."actorId" AS staff_id,
              (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS day,
              count(*) AS receipts
            FROM "LedgerEntry" l, bounds b
            WHERE l."tenantId" = ${tenantId}::text
              AND l."refType" = 'receipt'
              AND l.type = 'EARN'
              AND l."actorType" IN ('STAFF', 'OWNER')
              AND l."actorId" IS NOT NULL
              AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date >= b.base_start
            GROUP BY 1, 2
          ),
          stats AS (
            SELECT staff_id, avg(receipts) AS mean, stddev_pop(receipts) AS sd, count(*) AS active_days
            FROM daily
            GROUP BY staff_id
          )
          SELECT
            d.staff_id                          AS "staffId",
            to_char(d.day, 'YYYY-MM-DD')        AS "day",
            d.receipts                          AS "receipts",
            round(s.mean, 1)                    AS "usual"
          FROM daily d
          JOIN stats s ON s.staff_id = d.staff_id
          CROSS JOIN bounds b
          WHERE d.day >= b.cur_start
            AND s.active_days >= ${BURST_MIN_DAYS}::int
            AND d.receipts >= ${BURST_MIN_RECEIPTS}::int
            AND d.receipts > s.mean + 3 * s.sd
          ORDER BY d.receipts DESC, d.day DESC
          LIMIT ${LIST_MAX}::int
        `,
        tx.$queryRaw<CashierRow[]>`
          WITH bounds AS (
            SELECT
              date_trunc('day', now() AT TIME ZONE ${zone}) - make_interval(days => ${days}::int - 1) AS cur_start,
              date_trunc('day', now() AT TIME ZONE ${zone}) + interval '1 day'                       AS cur_end
          )
          SELECT
            l."actorId" AS "staffId",
            to_char((coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS "day",
            count(*) AS "receipts"
          FROM "LedgerEntry" l
          JOIN "Guest" g ON g.id = l."guestId"
          JOIN "Staff" s ON s.id = l."actorId" AND s."tenantId" = ${tenantId}::text
          CROSS JOIN bounds b
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
            AND l."actorType" IN ('STAFF', 'OWNER')
            AND g."phoneE164" IS NOT NULL
            AND g."phoneE164" = s."phoneE164"
            AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
            AND (coalesce(l."occurredAt", l."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
          GROUP BY 1, 2
          ORDER BY 3 DESC
          LIMIT ${LIST_MAX}::int
        `,
      ])

      const memberships = await tx.membership.findMany({
        where: { tenantId, id: { in: guestRows.map((row) => row.membershipId) } },
        select: {
          id: true,
          guestId: true,
          guest: { select: { displayName: true, phoneE164: true } },
        },
      })
      const byMembership = new Map(memberships.map((membership) => [membership.id, membership]))

      const names = await this.staffNames(tx, tenantId, [
        ...new Set([...burstRows, ...selfRows].map((row) => row.staffId)),
      ])

      const guests = guestRows.flatMap((row): SuspiciousGuest[] => {
        const membership = byMembership.get(row.membershipId)

        return membership === undefined
          ? []
          : [
              {
                membershipId: membership.id,
                guestId: membership.guestId,
                displayName: membership.guest.displayName,
                phone: membership.guest.phoneE164,
                day: row.day,
                receipts: toNumber(row.receipts),
              },
            ]
      })

      const cashier = (
        row: CashierRow,
        signal: SuspiciousCashier['signal'],
      ): SuspiciousCashier[] => {
        const name = names.get(row.staffId)

        return name === undefined
          ? []
          : [
              {
                staffId: row.staffId,
                displayName: name,
                signal,
                day: row.day,
                receipts: toNumber(row.receipts),
                usual: signal === 'BURST' ? toNumber(row.usual) : null,
              },
            ]
      }

      return {
        period: query.period,
        maxChecksPerDay,
        guests,
        // Номер кассира на гостя — однозначнее всплеска, поэтому первым.
        cashiers: [
          ...selfRows.flatMap((row) => cashier(row, 'SELF_LINKED')),
          ...burstRows.flatMap((row) => cashier(row, 'BURST')),
        ],
      }
    })
  }

  private async staffNames(
    tx: Parameters<Parameters<PrismaService['forTenant']>[1]>[0],
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map()
    }

    const people = await tx.staff.findMany({
      where: { tenantId, id: { in: [...ids] } },
      select: { id: true, displayName: true },
    })

    return new Map(people.map((person) => [person.id, person.displayName]))
  }
}
