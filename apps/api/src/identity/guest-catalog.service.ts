import { Injectable } from '@nestjs/common'
import { CATALOG_PAGE } from '@positive/contracts'
import type { GuestCatalog } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

import { currentGuestId } from './current-guest'

/**
 * Витрина «что взять за баллы». docs/02, раздел 2.13.
 *
 * ТОЛЬКО ПОЗИЦИИ С ЦЕНОЙ В БАЛЛАХ. Карта лояльности — не меню: список блюд
 * с ценами в батах отвлекает от того, ради чего её открыли.
 *
 * «ХВАТАЕТ ИЛИ НЕТ» СЧИТАЕМ МЫ, А НЕ ЭКРАН. Баланс у гостя свой в каждом
 * заведении, и заставлять приложение сводить два списка — верный способ
 * однажды показать «хватает» там, где не хватает.
 *
 * ГРАНИЦУ ДЕРЖИТ БАЗА: политика `guest_catalog` (миграция 20260918140000)
 * отдаёт включённые позиции заведений, где у гостя есть участие.
 */
@Injectable()
export class GuestCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<GuestCatalog> {
    const guestId = currentGuestId()

    const { rows, balances } = await this.prisma.forGuest(guestId, async (tx) => {
      const items = await tx.catalogItem.findMany({
        where: {
          isActive: true,
          pointsPrice: { not: null },
          tenant: { memberships: { some: { guestId } } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: CATALOG_PAGE,
        select: {
          id: true,
          tenantId: true,
          name: true,
          description: true,
          pointsPrice: true,
          imageUrl: true,
          tenant: { select: { brandName: true } },
        },
      })

      const memberships = await tx.membership.findMany({
        where: { guestId },
        select: { tenantId: true, pointsBalance: true },
      })

      return { rows: items, balances: memberships }
    })

    const balanceOf = new Map(balances.map((row) => [row.tenantId, row.pointsBalance]))

    return {
      items: rows.flatMap((row) =>
        row.pointsPrice === null
          ? []
          : [
              {
                id: row.id,
                tenantId: row.tenantId,
                venue: row.tenant.brandName,
                name: row.name,
                description: row.description,
                pointsPrice: row.pointsPrice,
                imageUrl: row.imageUrl,
                affordable: (balanceOf.get(row.tenantId) ?? 0) >= row.pointsPrice,
              },
            ],
      ),
    }
  }
}
