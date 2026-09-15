import { z } from 'zod'

/**
 * Новости заведения для гостей. docs/02, разделы 2.9 и 5.14 · docs/11, У13.
 *
 * НЕ УДАЛЯЕТСЯ, А СНИМАЕТСЯ С ПУБЛИКАЦИИ. Снятая новость — черновик: её можно поправить
 * и выпустить снова, а гость видит только опубликованные.
 *
 * ДАТА ПУБЛИКАЦИИ — ПЕРВАЯ. Правка опечатки не поднимает старую новость наверх ленты гостя.
 */

export const NEWS_TITLE_MAX = 120
export const NEWS_BODY_MAX = 2000

/** Новостей в ленте гостя — последние двадцать по всем его заведениям. */
export const GUEST_NEWS_MAX = 20

const Title = z
  .string()
  .trim()
  .min(2, 'Заголовок — от 2 знаков')
  .max(NEWS_TITLE_MAX, `Заголовок — не длиннее ${String(NEWS_TITLE_MAX)} знаков`)

const Body = z
  .string()
  .trim()
  .min(1, 'Напишите текст новости')
  .max(NEWS_BODY_MAX, `Текст — не длиннее ${String(NEWS_BODY_MAX)} знаков`)

// ─── Бэк-офис ────────────────────────────────────────────────────────────────

export const AdminNews = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string(),
    isPublished: z.boolean(),
    /** Когда впервые опубликована. null — ни разу. */
    publishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type AdminNews = z.infer<typeof AdminNews>

export const CreateNewsInput = z
  .object({
    title: Title,
    body: Body,
    /** Сразу показать гостям. По умолчанию — черновик. */
    publish: z.boolean().default(false),
  })
  .strict()

export type CreateNewsInput = z.infer<typeof CreateNewsInput>

export const UpdateNewsInput = z
  .object({
    title: Title.optional(),
    body: Body.optional(),
    isPublished: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined || input.body !== undefined || input.isPublished !== undefined,
    'Нечего менять',
  )

export type UpdateNewsInput = z.infer<typeof UpdateNewsInput>

// ─── Гость ───────────────────────────────────────────────────────────────────

export const GuestNewsItem = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    venue: z.string(),
    title: z.string(),
    body: z.string(),
    publishedAt: z.iso.datetime(),
  })
  .strict()

export type GuestNewsItem = z.infer<typeof GuestNewsItem>

export const GuestNews = z
  .object({
    /** Опубликованные новости заведений, где гость — гость; свежие сверху. */
    items: z.array(GuestNewsItem),
  })
  .strict()

export type GuestNews = z.infer<typeof GuestNews>
