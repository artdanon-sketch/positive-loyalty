import { Injectable } from '@nestjs/common'
import type { GuestHistory, GuestHistoryQuery, LedgerType } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { Prisma } from '../generated/prisma/client'

import { currentGuestId } from './current-guest'

/**
 * История операций гостя. docs/02, раздел 2.11.
 *
 * ГРАНИЦУ ДЕРЖИТ БАЗА: политика `guest_ledger` (миграция 20260826230000) отдаёт
 * гостю только его записи. Условие ниже — чтобы запрос читался.
 *
 * ПОРЯДОК ПО ДАТЕ ОПЕРАЦИИ, А НЕ ПО ДАТЕ ЗАПИСИ. Чек от кассы приходит вебхуком,
 * и вебхук опаздывает: смена, досланная вечером, встала бы поверх сегодняшнего
 * кофе и гость решил бы, что мы перепутали. Сортируем по `occurredAt`, а где
 * его нет — по `createdAt`, как это делает аналитика.
 *
 * НА ОДНУ ЗАПИСЬ БОЛЬШЕ, ЧЕМ ПРОСИЛИ — так узнаём, есть ли что показывать
 * дальше, не считая всю историю целиком.
 */
interface HistoryRow {
  id: string
  tenantId: string
  type: LedgerType
  amount: number
  balanceAfter: number
  basisAmount: number | null
  at: Date
  venue: string
}

@Injectable()
export class GuestHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: GuestHistoryQuery): Promise<GuestHistory> {
    const guestId = currentGuestId()
    const byTenant =
      query.tenantId === undefined ? Prisma.empty : Prisma.sql`AND l."tenantId" = ${query.tenantId}`

    // Сырой запрос — ради порядка: «дата операции, а где её нет — дата записи»
    // через Prisma не выразить. Раньше стояло «occurredAt по убыванию, пустые
    // в конце», и ВСЕ чеки с экрана кассира (у них даты операции нет) уходили под
    // любой старый чек из кассы POSitive: вчерашний кофе оказывался под сентябрём.
    const rows = await this.prisma.forGuest(
      guestId,
      async (tx) =>
        tx.$queryRaw<HistoryRow[]>`
        SELECT
          l.id,
          l."tenantId",
          l.type::text                          AS type,
          l.amount,
          l."balanceAfter",
          l."basisAmount",
          coalesce(l."occurredAt", l."createdAt") AS at,
          t."brandName"                         AS venue
        FROM "LedgerEntry" l
        JOIN "Tenant" t ON t.id = l."tenantId"
        WHERE l."guestId" = ${guestId} ${byTenant}
        ORDER BY coalesce(l."occurredAt", l."createdAt") DESC, l."createdAt" DESC, l.id DESC
        OFFSET ${query.offset}
        LIMIT ${query.limit + 1}
      `,
    )

    const page = rows.slice(0, query.limit)

    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        tenantId: row.tenantId,
        venue: row.venue,
        type: row.type,
        points: row.amount,
        basisAmount: row.basisAmount,
        balanceAfter: row.balanceAfter,
      })),
      hasMore: rows.length > query.limit,
    }
  }
}
