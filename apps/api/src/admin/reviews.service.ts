import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminReview,
  AdminReviewsList,
  AdminReviewsQuery,
  ReplyReviewInput,
} from '@positive/contracts'

import { maskPhone } from '../common/pii/mask-phone'
import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { PERIOD_DAYS } from './dashboard.service'
import { isReviewTag, summarizeReviews } from './review-summary'

/**
 * Отзывы гостей в бэк-офисе. docs/02, раздел 5.12 · docs/11, У10.
 *
 * СВОДКА — ЗА ПЕРИОД ЦЕЛИКОМ, СПИСОК — ПО ФИЛЬТРАМ. Владелец, открывший «ждут ответа»,
 * видит рядом общую картину, а не распределение из трёх отзывов.
 *
 * ГРАНИЦА ПЕРИОДА — ПО ЧАСАМ ЗАВЕДЕНИЯ, как в отчётах: «за неделю» начинается в полночь
 * на Пхукете.
 *
 * ТЕЛЕФОН — ПО РОЛИ, как в списке гостей: целиком владельцу, маскированный менеджеру.
 *
 * ОТВЕТ ЗАМЕНЯЕТ АВТООТВЕТ. Автоответ — вежливость до того, как владелец прочитал;
 * его слова после этого важнее. Исправить свой ответ тоже можно — прежний текст
 * остаётся в аудите.
 */

type Tx = Prisma.TransactionClient

const REVIEW_SELECT = {
  id: true,
  staffId: true,
  rating: true,
  tags: true,
  comment: true,
  reply: true,
  repliedAt: true,
  autoReply: true,
  createdAt: true,
  guest: { select: { displayName: true, phoneE164: true } },
  ledgerEntry: { select: { membershipId: true, basisAmount: true } },
} as const

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>

const toAdminReview = (
  row: ReviewRow,
  staffNames: ReadonlyMap<string, string>,
  showFullPhone: boolean,
): AdminReview => {
  const staffName = row.staffId === null ? undefined : staffNames.get(row.staffId)

  return {
    id: row.id,
    rating: row.rating,
    tags: row.tags.filter(isReviewTag),
    comment: row.comment,
    reply: row.reply,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    autoReply: row.autoReply,
    createdAt: row.createdAt.toISOString(),
    guest: {
      membershipId: row.ledgerEntry.membershipId,
      displayName: row.guest.displayName,
      phone: showFullPhone ? row.guest.phoneE164 : maskPhone(row.guest.phoneE164),
    },
    // Сотрудника, которого в заведении нет, показываем как чек без сотрудника: имя взять неоткуда.
    staff:
      row.staffId === null || staffName === undefined
        ? null
        : { id: row.staffId, displayName: staffName },
    amount: row.ledgerEntry.basisAmount,
  }
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminReviewsQuery): Promise<AdminReviewsList> {
    const { tenantId, role } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const since = await this.periodStart(tx, tenantId, PERIOD_DAYS[query.period])
      const period: Prisma.ReviewWhereInput = { tenantId, createdAt: { gte: since } }
      const filtered: Prisma.ReviewWhereInput = {
        ...period,
        ...(query.rating === undefined ? {} : { rating: query.rating }),
        ...(query.answered === undefined
          ? {}
          : { reply: query.answered === 'yes' ? { not: null } : null }),
      }

      const [all, total, rows] = await Promise.all([
        tx.review.findMany({ where: period, select: { rating: true, tags: true, reply: true } }),
        tx.review.count({ where: filtered }),
        tx.review.findMany({
          where: filtered,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: query.offset,
          take: query.limit,
          select: REVIEW_SELECT,
        }),
      ])

      const staffNames = await this.staffNames(tx, tenantId, rows)

      return {
        period: query.period,
        summary: summarizeReviews(all),
        total,
        items: rows.map((row) => toAdminReview(row, staffNames, role === 'OWNER')),
      }
    })
  }

  async reply(id: string, input: ReplyReviewInput): Promise<AdminReview> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.review.findFirst({
        where: { id, tenantId },
        select: { reply: true, autoReply: true },
      })

      if (current === null) {
        // Чужой отзыв — 404, а не 403: по ответу не должно быть видно, что он есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Отзыв не найден' },
        })
      }

      const row = await tx.review.update({
        where: { id },
        data: { reply: input.text, repliedAt: new Date(), repliedBy: actorId, autoReply: false },
        select: REVIEW_SELECT,
      })

      const staffNames = await this.staffNames(tx, tenantId, [row])

      return { before: current, after: toAdminReview(row, staffNames, role === 'OWNER') }
    })

    await this.audit.write({
      action: 'REVIEW_REPLIED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Review',
      entityId: id,
      oldValue: { reply: before.reply, autoReply: before.autoReply },
      newValue: { reply: after.reply },
    })

    return after
  }

  private async staffNames(
    tx: Tx,
    tenantId: string,
    rows: ReadonlyArray<{ staffId: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((row) => (row.staffId === null ? [] : [row.staffId])))]

    if (ids.length === 0) {
      return new Map()
    }

    const people = await tx.staff.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, displayName: true },
    })

    return new Map(people.map((person) => [person.id, person.displayName]))
  }

  /** Полночь первого дня периода по часам заведения. */
  private async periodStart(tx: Tx, tenantId: string, days: number): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ since: Date }>>`
      SELECT (date_trunc('day', now() AT TIME ZONE t.timezone)
               - make_interval(days => ${days}::int - 1)) AT TIME ZONE t.timezone AS since
      FROM "Tenant" t
      WHERE t.id = ${tenantId}::text
    `
    const since = rows[0]?.since

    if (since === undefined) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return since
  }
}
