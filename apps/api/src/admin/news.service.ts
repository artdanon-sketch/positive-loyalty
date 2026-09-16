import { Injectable, NotFoundException } from '@nestjs/common'
import type { AdminNews, CreateNewsInput, UpdateNewsInput } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Новости заведения в бэк-офисе. docs/02, раздел 5.14 · docs/11, У13.
 *
 * НЕ УДАЛЯЕТСЯ, А СНИМАЕТСЯ С ПУБЛИКАЦИИ: гость, уже прочитавший новость, не должен
 * гадать, куда она делась, а владелец — терять текст, который хочет выпустить снова.
 *
 * ДАТА ПУБЛИКАЦИИ СТАВИТСЯ ОДИН РАЗ — при первой публикации. Снять и выпустить снова
 * можно, но наверх ленты гостя это новость не поднимет.
 *
 * В аудит — создание и каждая правка: гостям уходит текст от имени заведения.
 *
 * ПРОСМОТРЫ — ГОСТИ, А НЕ ПОКАЗЫ (миграция 20260916140000): у отметки UNIQUE на пару
 * «новость + гость», и владелец видит, до скольких человек новость дошла.
 */

const NEWS_SELECT = {
  id: true,
  title: true,
  body: true,
  isPublished: true,
  publishedAt: true,
  createdAt: true,
  _count: { select: { views: true } },
} as const

/** Сколько новостей в списке бэк-офиса. */
const LIST_MAX = 100

interface NewsRow {
  id: string
  title: string
  body: string
  isPublished: boolean
  publishedAt: Date | null
  createdAt: Date
  _count: { views: number }
}

const toAdminNews = (row: NewsRow): AdminNews => ({
  id: row.id,
  title: row.title,
  body: row.body,
  isPublished: row.isPublished,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  views: row._count.views,
  createdAt: row.createdAt.toISOString(),
})

@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminNews[]> {
    const { tenantId } = TenantContext.getOrThrow()

    const rows = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.news.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_MAX,
        select: NEWS_SELECT,
      }),
    )

    return rows.map(toAdminNews)
  }

  async create(input: CreateNewsInput): Promise<AdminNews> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const row = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.news.create({
        data: {
          tenantId,
          title: input.title,
          body: input.body,
          isPublished: input.publish,
          publishedAt: input.publish ? new Date() : null,
        },
        select: NEWS_SELECT,
      }),
    )

    await this.audit.write({
      action: 'NEWS_CREATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'News',
      entityId: row.id,
      newValue: { title: row.title, isPublished: row.isPublished },
    })

    return toAdminNews(row)
  }

  async update(id: string, input: UpdateNewsInput): Promise<AdminNews> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.news.findFirst({ where: { id, tenantId }, select: NEWS_SELECT })

      if (current === null) {
        // Чужая новость — 404, а не 403: по ответу не должно быть видно, что она есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Новость не найдена' },
        })
      }

      const publishingFirstTime = input.isPublished === true && current.publishedAt === null

      const row = await tx.news.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
          ...(publishingFirstTime ? { publishedAt: new Date() } : {}),
        },
        select: NEWS_SELECT,
      })

      return { before: current, after: row }
    })

    await this.audit.write({
      action: 'NEWS_UPDATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'News',
      entityId: id,
      oldValue: { title: before.title, isPublished: before.isPublished },
      newValue: { title: after.title, isPublished: after.isPublished },
    })

    return toAdminNews(after)
  }
}
