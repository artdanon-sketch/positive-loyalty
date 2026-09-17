import { Injectable } from '@nestjs/common'
import { GUEST_NEWS_MAX } from '@positive/contracts'
import type { GuestNews, GuestNewsSeen, GuestNewsSeenInput } from '@positive/contracts'

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
 *
 * ПРОСМОТР ОТМЕЧАЕТСЯ ОДИН РАЗ НА ГОСТЯ (UNIQUE в миграции 20260916140000): открытая
 * пять раз карта — это один дошедший человек, а не пять просмотров. Повтор молча
 * пропускается, а не падает ошибкой: гость ничего неправильного не сделал.
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
          imageUrl: true,
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
                imageUrl: row.imageUrl,
                publishedAt: row.publishedAt.toISOString(),
              },
            ],
      ),
    }
  }

  /**
   * Отметить новости увиденными. Заведение берётся из самой новости, а не из запроса:
   * гость его не выбирает, а подсунуть чужое через тело запроса было бы можно.
   */
  async markSeen(input: GuestNewsSeenInput): Promise<GuestNewsSeen> {
    const guestId = currentGuestId()

    return this.prisma.forGuest(guestId, async (tx) => {
      // Границу держит RLS, условия — те же, что у ленты: без них запрос под владельцем
      // базы (интеграционные тесты, миграции) отметил бы и чужую новость.
      const visible = await tx.news.findMany({
        where: {
          id: { in: input.ids },
          isPublished: true,
          tenant: { memberships: { some: { guestId } } },
        },
        select: { id: true, tenantId: true },
      })

      if (visible.length === 0) {
        return { counted: 0 }
      }

      const created = await tx.newsView.createMany({
        data: visible.map((row) => ({ tenantId: row.tenantId, newsId: row.id, guestId })),
        skipDuplicates: true,
      })

      return { counted: created.count }
    })
  }
}
