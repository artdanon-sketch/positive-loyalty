import { z } from 'zod'

import { DashboardPeriod } from './admin.js'
import { ReviewReplyText } from './review-config.js'

/**
 * Отзывы гостей. docs/02, разделы 2.8 и 5.12 · docs/11, У10.
 *
 * ОДИН ОТЗЫВ НА ЧЕК. Якорь — начисление по чеку: оно есть у каждого чека, даже нулевое
 * (группа сравнения), поэтому оценить визит может любой гость, а второй отзыв на тот же
 * чек не пустит база.
 *
 * ОЦЕНИТЬ МОЖНО НЕДАВНИЙ ВИЗИТ. Через месяц гость не помнит, долго ли ждал: такой отзыв
 * ничего не скажет владельцу.
 */

export const REVIEW_WINDOW_DAYS = 7
export const REVIEW_COMMENT_MAX = 1000

/** Быстрые отзывы — темы как у UDS: качество, цены, ассортимент, сервис, персонал. */
export const ReviewTag = z.enum(['QUALITY', 'PRICE', 'ASSORTMENT', 'SERVICE', 'STAFF'])
export type ReviewTag = z.infer<typeof ReviewTag>

export const REVIEW_TAGS: readonly ReviewTag[] = ReviewTag.options

const Rating = z.number().int().min(1, 'Оценка — от 1 до 5').max(5, 'Оценка — от 1 до 5')
const Count = z.number().int().nonnegative()

// ─── Гость ───────────────────────────────────────────────────────────────────

export const CreateReviewInput = z
  .object({
    /** Начисление по чеку — из списка «оцените визит». */
    ledgerEntryId: z.uuid(),
    rating: Rating,
    tags: z
      .array(ReviewTag)
      .max(REVIEW_TAGS.length)
      .refine((tags) => new Set(tags).size === tags.length, 'Тема отзыва указана дважды')
      .default([]),
    comment: z.string().trim().min(1).max(REVIEW_COMMENT_MAX).optional(),
  })
  .strict()

export type CreateReviewInput = z.infer<typeof CreateReviewInput>

export const GuestReview = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    venue: z.string(),
    rating: Rating,
    tags: z.array(ReviewTag),
    comment: z.string().nullable(),
    /** Ответ заведения — владельца или автоответ: гостю они не различаются. */
    reply: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type GuestReview = z.infer<typeof GuestReview>

/** Визит, который можно оценить. */
export const ReviewableVisit = z
  .object({
    ledgerEntryId: z.uuid(),
    tenantId: z.uuid(),
    venue: z.string(),
    visitedAt: z.iso.datetime(),
    /** Сумма чека в сатангах. */
    amount: Count.nullable(),
  })
  .strict()

export type ReviewableVisit = z.infer<typeof ReviewableVisit>

export const GuestReviews = z
  .object({
    /** Недавние неоценённые визиты — по одному на заведение, свежие сверху. */
    pending: z.array(ReviewableVisit),
    /** Свои отзывы с ответами, свежие сверху. */
    items: z.array(GuestReview),
  })
  .strict()

export type GuestReviews = z.infer<typeof GuestReviews>

// ─── Бэк-офис ────────────────────────────────────────────────────────────────

export const AdminReviewsQuery = z
  .object({
    period: DashboardPeriod.default('30d'),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    /** `yes` — с ответом, `no` — ждут ответа. */
    answered: z.enum(['yes', 'no']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export type AdminReviewsQuery = z.infer<typeof AdminReviewsQuery>

export const AdminReview = z
  .object({
    id: z.uuid(),
    rating: Rating,
    tags: z.array(ReviewTag),
    comment: z.string().nullable(),
    reply: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    /** Ответ — автоответ по числу звёзд, а не слова владельца. */
    autoReply: z.boolean(),
    createdAt: z.iso.datetime(),
    guest: z
      .object({
        /** Участие — чтобы открыть карточку гостя. */
        membershipId: z.uuid(),
        displayName: z.string().nullable(),
        /** Целиком у владельца, маскированный у менеджера — как в списке гостей. */
        phone: z.string().nullable(),
      })
      .strict(),
    /** Кто провёл чек. null — чек пришёл из кассы вебхуком. */
    staff: z.object({ id: z.uuid(), displayName: z.string() }).strict().nullable(),
    /** Сумма чека в сатангах. */
    amount: Count.nullable(),
  })
  .strict()

export type AdminReview = z.infer<typeof AdminReview>

export const ReviewsSummary = z
  .object({
    total: Count,
    /** Средняя оценка с одним знаком после запятой. null — отзывов нет. */
    average: z.number().min(1).max(5).nullable(),
    /** Сколько отзывов на каждую оценку: «1», «2», «3», «4», «5». */
    distribution: z.array(Count).length(5),
    /** Быстрые отзывы по темам — все пять, чаще упомянутые сверху. */
    tags: z.array(z.object({ tag: ReviewTag, count: Count }).strict()),
    /** Ждут ответа: не ответили ни владелец, ни автоответ. */
    unanswered: Count,
  })
  .strict()

export type ReviewsSummary = z.infer<typeof ReviewsSummary>

export const AdminReviewsList = z
  .object({
    period: DashboardPeriod,
    /** Сводка за период — без фильтров по оценке и ответу. */
    summary: ReviewsSummary,
    /** Сколько отзывов подходит под фильтры — для листания. */
    total: Count,
    items: z.array(AdminReview),
  })
  .strict()

export type AdminReviewsList = z.infer<typeof AdminReviewsList>

export const ReplyReviewInput = z
  .object({
    text: ReviewReplyText,
  })
  .strict()

export type ReplyReviewInput = z.infer<typeof ReplyReviewInput>
