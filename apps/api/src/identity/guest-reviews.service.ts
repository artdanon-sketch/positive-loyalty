import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ProgramConfig, REVIEW_WINDOW_DAYS, ReviewTag } from '@positive/contracts'
import type {
  CreateReviewInput,
  GuestReview,
  GuestReviews,
  ReviewableVisit,
} from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { isUniqueViolation } from '../core/random-code'
import type { Prisma } from '../generated/prisma/client'
import { currentGuestId } from './current-guest'

/**
 * Отзывы гостя. docs/02, раздел 2.8 · docs/11, У10.
 *
 * ВСЁ — ГОСТЕВЫМ КОНТУРОМ RLS. Свой чек гость читает политикой `guest_ledger`, свои
 * отзывы — `guest_reviews`, а записать отзыв база даст только о своём чеке и в его же
 * заведении (`guest_reviews_insert`, миграция 20260916040000). Проверки ниже нужны,
 * чтобы ответить понятным кодом, а не чтобы удержать границу: её держит база.
 *
 * АВТООТВЕТ — В ТОЙ ЖЕ ЗАПИСИ. Гость, поставивший «2», сразу видит, что его услышали,
 * а не ждёт, пока владелец откроет бэк-офис.
 *
 * КАССИР — ИЗ ЖУРНАЛА. Гость не выбирает, кто его обслужил: чек провёл тот, кто провёл.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** «Оцените визит» — не больше трёх: это просьба, а не анкета. */
const PENDING_MAX = 3

/** Кандидатов в «оцените визит» читаем с запасом: по одному на заведение. */
const PENDING_SCAN = 20

/** Своих отзывов в ответе — последние пятьдесят. */
const OWN_MAX = 50

const VISIT_NOT_FOUND = {
  error: { code: 'VISIT_NOT_FOUND', message: 'Чек не найден или отменён' },
}

const REVIEW_EXISTS = {
  error: { code: 'REVIEW_EXISTS', message: 'Этот визит вы уже оценили' },
}

const REVIEW_SELECT = {
  id: true,
  tenantId: true,
  rating: true,
  tags: true,
  comment: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  tenant: { select: { brandName: true } },
} as const

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>

const isTag = (value: string): value is ReviewTag => ReviewTag.safeParse(value).success

const toGuestReview = (row: ReviewRow): GuestReview => ({
  id: row.id,
  tenantId: row.tenantId,
  venue: row.tenant.brandName,
  rating: row.rating,
  tags: row.tags.filter(isTag),
  comment: row.comment,
  reply: row.reply,
  repliedAt: row.repliedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

/** Время визита — когда чек закрыт, а не когда касса его дослала. */
const visitedAt = (entry: { occurredAt: Date | null; createdAt: Date }): Date =>
  entry.occurredAt ?? entry.createdAt

const windowStart = (now: Date): Date => new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS)

@Injectable()
export class GuestReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<GuestReviews> {
    const guestId = currentGuestId()
    const since = windowStart(new Date())

    return this.prisma.forGuest(guestId, async (tx) => {
      const [visits, reviews] = await Promise.all([
        tx.ledgerEntry.findMany({
          where: {
            guestId,
            refType: 'receipt',
            type: 'EARN',
            reversedBy: { is: null },
            review: { is: null },
            OR: [{ occurredAt: { gte: since } }, { occurredAt: null, createdAt: { gte: since } }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: PENDING_SCAN,
          select: {
            id: true,
            tenantId: true,
            basisAmount: true,
            occurredAt: true,
            createdAt: true,
            tenant: { select: { brandName: true } },
          },
        }),
        tx.review.findMany({
          where: { guestId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: OWN_MAX,
          select: REVIEW_SELECT,
        }),
      ])

      // По одному визиту на заведение: три чека за вечер в одном баре — один вечер.
      const pending: ReviewableVisit[] = []
      const venues = new Set<string>()

      for (const visit of visits) {
        if (pending.length === PENDING_MAX) {
          break
        }

        if (venues.has(visit.tenantId)) {
          continue
        }

        venues.add(visit.tenantId)
        pending.push({
          ledgerEntryId: visit.id,
          tenantId: visit.tenantId,
          venue: visit.tenant.brandName,
          visitedAt: visitedAt(visit).toISOString(),
          amount: visit.basisAmount,
        })
      }

      return { pending, items: reviews.map(toGuestReview) }
    })
  }

  async create(input: CreateReviewInput): Promise<GuestReview> {
    const guestId = currentGuestId()

    try {
      return await this.prisma.forGuest(guestId, async (tx) => {
        const entry = await tx.ledgerEntry.findFirst({
          where: { id: input.ledgerEntryId, guestId, refType: 'receipt', type: 'EARN' },
          select: {
            id: true,
            tenantId: true,
            actorType: true,
            actorId: true,
            occurredAt: true,
            createdAt: true,
            reversedBy: { select: { id: true } },
            review: { select: { id: true } },
            tenant: { select: { settings: true } },
          },
        })

        // Чужой, не чековый и отменённый чек отвечают одинаково: оценивать нечего.
        if (entry === null || entry.reversedBy !== null) {
          throw new NotFoundException(VISIT_NOT_FOUND)
        }

        if (entry.review !== null) {
          throw new ConflictException(REVIEW_EXISTS)
        }

        const now = new Date()

        if (visitedAt(entry) < windowStart(now)) {
          throw new ConflictException({
            error: {
              code: 'REVIEW_WINDOW_CLOSED',
              message: `Оценить визит можно в течение ${String(REVIEW_WINDOW_DAYS)} дней`,
            },
          })
        }

        const program = ProgramConfig.safeParse(entry.tenant.settings ?? {})
        const autoReply = program.success
          ? (program.data.reviews.autoReplies[input.rating - 1] ?? null)
          : null

        const row = await tx.review.create({
          data: {
            tenantId: entry.tenantId,
            guestId,
            ledgerEntryId: entry.id,
            staffId:
              entry.actorType === 'STAFF' || entry.actorType === 'OWNER' ? entry.actorId : null,
            rating: input.rating,
            tags: input.tags,
            comment: input.comment ?? null,
            ...(autoReply === null ? {} : { reply: autoReply, repliedAt: now, autoReply: true }),
          },
          select: REVIEW_SELECT,
        })

        return toGuestReview(row)
      })
    } catch (error) {
      // Две вкладки отправили отзыв одновременно — второй упёрся в уникальность чека.
      if (isUniqueViolation(error)) {
        throw new ConflictException(REVIEW_EXISTS)
      }

      throw error
    }
  }
}
