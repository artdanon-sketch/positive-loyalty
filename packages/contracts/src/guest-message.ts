import { z } from 'zod'

/**
 * Жалобы и предложения — обращение гостя не по визиту. docs/02, разделы 2.10 и 5.15.
 *
 * ОТДЕЛЬНО ОТ ОТЗЫВОВ. Отзыв привязан к чеку и оценивает визит; жалоба на грязный
 * туалет и предложение поставить веганский суп к конкретному чеку не относятся,
 * а гость может прийти и вовсе без покупки в этот день.
 *
 * ЗВЁЗД НЕТ. Обращение — текст, а не оценка: «поставьте, пожалуйста, зарядки»
 * не бывает на четыре звезды. Отчёты по нему не строятся — на него отвечают.
 *
 * ДВА ВИДА ВМЕСТО СВОБОДНОЙ ТЕМЫ: владелец разбирает жалобы первыми, а предложения
 * читает на досуге. Третьего вида не заводим — «прочее» сделало бы сортировку бессмысленной.
 */

export const GUEST_MESSAGE_TEXT_MAX = 1000
export const GUEST_MESSAGE_REPLY_MAX = 1000

/** Своих обращений гостю показываем последние двадцать. */
export const GUEST_MESSAGES_MAX = 20

/** Обращений в списке бэк-офиса за раз. */
export const ADMIN_MESSAGES_PAGE = 20

/**
 * Сколько обращений без ответа гость может оставить одному заведению. Не «в сутки»:
 * заведение, которое отвечает, читает и следующее письмо; молчащее — не получает поток.
 */
export const GUEST_MESSAGES_PENDING_MAX = 3

export const GuestMessageKind = z.enum(['COMPLAINT', 'SUGGESTION'])
export type GuestMessageKind = z.infer<typeof GuestMessageKind>

const Text = z
  .string()
  .trim()
  .min(2, 'Напишите, что случилось')
  .max(GUEST_MESSAGE_TEXT_MAX, `Не длиннее ${String(GUEST_MESSAGE_TEXT_MAX)} знаков`)

// ─── Гость ───────────────────────────────────────────────────────────────────

export const CreateGuestMessageInput = z
  .object({
    /** Кому: заведение, где гость бывал. */
    tenantId: z.uuid(),
    kind: GuestMessageKind,
    text: Text,
  })
  .strict()

export type CreateGuestMessageInput = z.infer<typeof CreateGuestMessageInput>

export const GuestMessageView = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    venue: z.string(),
    kind: GuestMessageKind,
    text: z.string(),
    /** Ответ заведения. null — ещё не ответили. */
    reply: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type GuestMessageView = z.infer<typeof GuestMessageView>

export const GuestMessages = z
  .object({
    items: z.array(GuestMessageView),
  })
  .strict()

export type GuestMessages = z.infer<typeof GuestMessages>

// ─── Бэк-офис ────────────────────────────────────────────────────────────────

export const AdminMessagesQuery = z
  .object({
    kind: GuestMessageKind.optional(),
    /** «no» — только без ответа: с них начинается разбор. */
    answered: z.enum(['yes', 'no']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(ADMIN_MESSAGES_PAGE),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict()

export type AdminMessagesQuery = z.infer<typeof AdminMessagesQuery>

export const AdminGuestMessage = z
  .object({
    id: z.uuid(),
    kind: GuestMessageKind,
    text: z.string(),
    reply: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    guest: z
      .object({
        guestId: z.uuid(),
        /** Участие в этом заведении — по нему открывается карточка. null — гость вышел. */
        membershipId: z.uuid().nullable(),
        displayName: z.string().nullable(),
        /** Целиком у владельца, маскированный у менеджера — как в отзывах. */
        phone: z.string().nullable(),
      })
      .strict(),
  })
  .strict()

export type AdminGuestMessage = z.infer<typeof AdminGuestMessage>

export const AdminMessagesList = z
  .object({
    /** Сколько обращений подходит под фильтры — для листания. */
    total: z.number().int().nonnegative(),
    /** Ждут ответа — по всему заведению, а не по текущему фильтру. */
    unanswered: z.number().int().nonnegative(),
    items: z.array(AdminGuestMessage),
  })
  .strict()

export type AdminMessagesList = z.infer<typeof AdminMessagesList>

export const ReplyGuestMessageInput = z
  .object({
    /** Поле названо как у ответа на отзыв: один способ отвечать гостю, а не два. */
    text: z
      .string()
      .trim()
      .min(1, 'Напишите ответ')
      .max(GUEST_MESSAGE_REPLY_MAX, `Ответ — не длиннее ${String(GUEST_MESSAGE_REPLY_MAX)} знаков`),
  })
  .strict()

export type ReplyGuestMessageInput = z.infer<typeof ReplyGuestMessageInput>
