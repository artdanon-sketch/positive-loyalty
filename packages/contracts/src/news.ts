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
    /** Сколько гостей увидело новость. Гость считается один раз, сколько бы ни открывал. */
    views: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    /** Картинка новости. null — без картинки. */
    imageUrl: z.url().nullable().default(null),
  })
  .strict()

export type AdminNews = z.infer<typeof AdminNews>

/**
 * Картинка новости — ССЫЛКОЙ, а не файлом.
 *
 * Хранилища картинок у нас пока нет, и заводить его ради новостей — отдельная
 * работа. Ссылка на уже выложенную картинку (в соцсети заведения, в облаке)
 * закрывает тот же случай сегодня; загрузка появится вместе с хранилищем.
 *
 * Только https: картинка по http не покажется на карте гостя — браузер её
 * заблокирует, и владелец увидит пустое место вместо объяснения.
 */
const ImageUrl = z
  .url('Нужна ссылка на картинку')
  .max(500)
  .refine((value) => value.startsWith('https://'), 'Ссылка должна начинаться с https://')

export const CreateNewsInput = z
  .object({
    title: Title,
    body: Body,
    /** Сразу показать гостям. По умолчанию — черновик. */
    publish: z.boolean().default(false),
    /** Картинка к новости. null — без картинки. */
    imageUrl: ImageUrl.nullable().default(null),
    /**
     * Сообщить гостям о новости.
     *
     * СОЗДАЁТ ОБЫЧНУЮ РАССЫЛКУ, а не шлёт сам: только так на неё действуют
     * ограничение «не больше четырёх сообщений в месяц», архив и оба канала
     * связи. Второго способа писать гостю мы не заводим.
     */
    notify: z.boolean().default(false),
  })
  .strict()

export type CreateNewsInput = z.infer<typeof CreateNewsInput>

export const UpdateNewsInput = z
  .object({
    title: Title.optional(),
    body: Body.optional(),
    isPublished: z.boolean().optional(),
    /** Картинка: ссылка или null, чтобы убрать. */
    imageUrl: ImageUrl.nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.body !== undefined ||
      input.isPublished !== undefined ||
      input.imageUrl !== undefined,
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
    /** Картинка новости. null — без картинки. */
    imageUrl: z.url().nullable().default(null),
  })
  .strict()

export type GuestNewsItem = z.infer<typeof GuestNewsItem>

/**
 * Отметка «увидел». Пачкой: карта показывает три новости разом, и три запроса подряд
 * с телефона у стойки — три шанса не дождаться ответа.
 */
export const GuestNewsSeenInput = z
  .object({
    ids: z.array(z.uuid()).min(1).max(GUEST_NEWS_MAX),
  })
  .strict()

export type GuestNewsSeenInput = z.infer<typeof GuestNewsSeenInput>

export const GuestNewsSeen = z
  .object({
    /** Сколько отметок легло впервые. Повторные не считаются. */
    counted: z.number().int().nonnegative(),
  })
  .strict()

export type GuestNewsSeen = z.infer<typeof GuestNewsSeen>

export const GuestNews = z
  .object({
    /** Опубликованные новости заведений, где гость — гость; свежие сверху. */
    items: z.array(GuestNewsItem),
  })
  .strict()

export type GuestNews = z.infer<typeof GuestNews>
