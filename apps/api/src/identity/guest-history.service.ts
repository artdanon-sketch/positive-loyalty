import { Injectable } from '@nestjs/common'
import type { GuestHistory, GuestHistoryQuery } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

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
@Injectable()
export class GuestHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: GuestHistoryQuery): Promise<GuestHistory> {
    const guestId = currentGuestId()

    const rows = await this.prisma.forGuest(guestId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          guestId,
          ...(query.tenantId === undefined ? {} : { tenantId: query.tenantId }),
        },
        orderBy: [{ occurredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: query.offset,
        take: query.limit + 1,
        select: {
          id: true,
          tenantId: true,
          type: true,
          amount: true,
          balanceAfter: true,
          basisAmount: true,
          occurredAt: true,
          createdAt: true,
          tenant: { select: { brandName: true } },
        },
      }),
    )

    const page = rows.slice(0, query.limit)

    return {
      items: page.map((row) => ({
        id: row.id,
        at: (row.occurredAt ?? row.createdAt).toISOString(),
        tenantId: row.tenantId,
        venue: row.tenant.brandName,
        type: row.type,
        points: row.amount,
        basisAmount: row.basisAmount,
        balanceAfter: row.balanceAfter,
      })),
      hasMore: rows.length > query.limit,
    }
  }
}
