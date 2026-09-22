import { ForbiddenException, Injectable } from '@nestjs/common'
import { ProgramConfig } from '@positive/contracts'
import type { PosHistory, PosHistoryQuery, PosInvite, PosMe, PosStats } from '@positive/contracts'

import { getEnv } from '../common/config/env'
import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Приложение кассира сверх «Счёта»: пригласить, история, профиль.
 * docs/02, раздел 3.6.
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
 */

/** Средняя оценка считается за это окно: месяц — достаточно свежо и не пусто. */
const RATING_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Сдвиг часового пояса заведения на момент `at`, в виде «+07:00».
 *
 * Через Intl, а не константой: у Пхукета сдвиг постоянный, но заведение может
 * оказаться где угодно, а библиотеку поясов ради одной строки тащить незачем.
 */
const zoneOffset = (timezone: string, at: Date): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(at)

  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const offset = name.replace('GMT', '')

  return offset === '' ? '+00:00' : offset
}

/** Полночь местного дня как настоящий момент времени UTC. */
const startOfLocalDay = (timezone: string, at: Date): Date => {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

  return new Date(`${ymd}T00:00:00${zoneOffset(timezone, at)}`)
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
    const rules = await this.rules(tenantId)

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
    const rules = await this.rules(tenantId)

    if (!rules.showOwnHistory) {
      throw new ForbiddenException({
        error: { code: 'FORBIDDEN', message: 'История смены выключена в настройках' },
      })
    }

    if (actorId === null) {
      // Сессия без сотрудника: показывать «свои» операции некому.
      return { items: [], total: 0, count: 0 }
    }

    const timezone = await this.timezone(tenantId)
    const { from, to } = this.window(query, timezone)

    const rows = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          tenantId,
          actorId,
          actorType: { in: ['STAFF', 'OWNER'] },
          type: 'EARN',
          // occurredAt — время события, createdAt — время записи. У чека,
          // долежавшего в очереди без связи, они разные, и правда здесь первая.
          OR: [
            { occurredAt: { gte: from, lte: to } },
            { occurredAt: null, createdAt: { gte: from, lte: to } },
          ],
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          amount: true,
          basisAmount: true,
          occurredAt: true,
          createdAt: true,
          guest: { select: { displayName: true } },
        },
      }),
    )

    const items = rows.map((row) => ({
      id: row.id,
      occurredAt: (row.occurredAt ?? row.createdAt).toISOString(),
      guest: row.guest.displayName ?? 'Без имени',
      amount: row.basisAmount ?? 0,
      points: row.amount,
    }))

    return {
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
      count: items.length,
    }
  }

  /** Кто я и где работаю. Показатели — только если владелец их открыл. */
  async me(): Promise<PosMe> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()
    const rules = await this.rules(tenantId)

    const { venue, displayName } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { brandName: true },
      })

      const staff =
        actorId === null
          ? null
          : await tx.staff.findFirst({
              where: { id: actorId, tenantId },
              select: { displayName: true },
            })

      return { venue: tenant?.brandName ?? '', displayName: staff?.displayName ?? '' }
    })

    const safeRole = role === 'CASHIER' || role === 'MANAGER' || role === 'OWNER' ? role : 'CASHIER'

    return {
      displayName,
      role: safeRole,
      venue,
      stats: rules.showOwnStats ? await this.stats(tenantId, actorId) : null,
    }
  }

  /** Выручка сегодняшней смены и средняя оценка гостей за месяц. */
  private async stats(tenantId: string, actorId: string | null): Promise<PosStats> {
    if (actorId === null) {
      return { shiftRevenue: 0, shiftCount: 0, rating: null }
    }

    const timezone = await this.timezone(tenantId)
    const now = new Date()
    const dayStart = startOfLocalDay(timezone, now)
    const since = new Date(now.getTime() - RATING_WINDOW_DAYS * DAY_MS)

    return this.prisma.forTenant(tenantId, async (tx) => {
      const shift = await tx.ledgerEntry.aggregate({
        where: {
          tenantId,
          actorId,
          actorType: { in: ['STAFF', 'OWNER'] },
          type: 'EARN',
          OR: [
            { occurredAt: { gte: dayStart, lte: now } },
            { occurredAt: null, createdAt: { gte: dayStart, lte: now } },
          ],
        },
        _sum: { basisAmount: true },
        _count: { _all: true },
      })

      const reviews = await tx.review.aggregate({
        where: { tenantId, staffId: actorId, createdAt: { gte: since } },
        _avg: { rating: true },
      })

      const average = reviews._avg.rating

      return {
        shiftRevenue: shift._sum.basisAmount ?? 0,
        shiftCount: shift._count._all,
        // Десятая доля — как в отчёте «Сотрудники»: «4,7» читается, «4,6666» нет.
        rating: average === null ? null : Math.round(average * 10) / 10,
      }
    })
  }

  /** Границы периода по часам заведения. */
  private window(query: PosHistoryQuery, timezone: string): { from: Date; to: Date } {
    const now = new Date()

    if (query.period === 'range' && query.from !== undefined && query.to !== undefined) {
      const offset = zoneOffset(timezone, now)
      return {
        from: new Date(`${query.from}T00:00:00${offset}`),
        to: new Date(`${query.to}T23:59:59.999${offset}`),
      }
    }

    const dayStart = startOfLocalDay(timezone, now)
    const back = query.period === 'week' ? 6 : query.period === 'month' ? 29 : 0

    return { from: new Date(dayStart.getTime() - back * DAY_MS), to: now }
  }

  private async rules(tenantId: string): Promise<ProgramConfig['cashierRules']> {
    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    return ProgramConfig.parse(tenant?.settings ?? {}).cashierRules
  }

  private async timezone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } }),
    )

    return tenant?.timezone ?? 'Asia/Bangkok'
  }
}
