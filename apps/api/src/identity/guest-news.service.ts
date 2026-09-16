import { Injectable } from '@nestjs/common'
import { GUEST_NEWS_MAX } from '@positive/contracts'
import type { GuestNews } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { currentGuestId } from './current-guest'

/**
 * Лента новостей гостя. docs/02, раздел 2.9 · docs/11, У13.
 *
 * ОДНА ЛЕНТА НА ВСЕ ЗАВЕДЕНИЯ. Карта гостя — общая на сеть, и запрос на каждое заведение
 * размножил бы их по числу мест, где гость бывал. Отступление от docs/11, где лента
 * была на заведение.
 *
 * ГРАНИЦУ ДЕРЖИТ БАЗА. Гостевой контур RLS (`guest_news`, миграция 20260916080000)
 * отдаёт только опубликованные новости заведений, где у гостя есть участие. Условия
 * ниже — чтобы запрос был понятен, а не чтобы удержать границу.
 */
@Injectable()
export class GuestNewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<GuestNews> {
    const guestId = currentGuestId()

    const rows = await this.prisma.forGuest(guestId, async (tx) =>
      tx.news.findMany({
        where: {
          isPublished: true,
          publishedAt: { not: null },
          tenant: { memberships: { some: { guestId } } },
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: GUEST_NEWS_MAX,
        select: {
          id: true,
          tenantId: true,
          title: true,
          body: true,
          publishedAt: true,
          tenant: { select: { brandName: true } },
        },
      }),
    )

    return {
      items: rows.flatMap((row) =>
        row.publishedAt === null
          ? []
          : [
              {
                id: row.id,
                tenantId: row.tenantId,
                venue: row.tenant.brandName,
                title: row.title,
                body: row.body,
                publishedAt: row.publishedAt.toISOString(),
              },
            ],
      ),
    }
  }
}
