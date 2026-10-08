import { z } from 'zod'

import { AdminGuestsQuery } from './admin.js'
import { BirthdayReward } from './birthday.js'

/**
 * Рассылки заведения. docs/02, раздел 5.4 · docs/03, раздел 5.
 *
 * АУДИТОРИЯ — ТЕ ЖЕ ФИЛЬТРЫ, ЧТО В СПИСКЕ ГОСТЕЙ. Владелец уже умеет ими
 * пользоваться: «спящие резиденты со статусом Золото» выбираются одинаково
 * и в списке, и в рассылке. Второго языка сегментов не заводим.
 *
 * ПРЕДПРОСМОТР ОБЯЗАТЕЛЕН ДО ОТПРАВКИ. Владелец должен видеть не только «сколько
 * нашлось», но и сколько из них реально получит сообщение: у части гостей нет
 * Telegram, часть уже получила свои четыре сообщения за месяц.
 *
 * УСТАЛОСТЬ — ЧЕТЫРЕ СООБЩЕНИЯ В МЕСЯЦ на гостя от одного заведения (docs/02,
 * раздел 5.4). Пятое не отправляется. База выгорает быстрее, чем растёт.
 */

export const BROADCAST_TEXT_MAX = 1000
export const BROADCAST_TITLE_MAX = 60

/** Сколько сообщений заведение может отправить одному гостю за окно усталости. */
export const BROADCAST_FATIGUE_LIMIT = 4

/** Окно усталости в днях. */
export const BROADCAST_FATIGUE_DAYS = 30

/** Рассылок в списке бэк-офиса за раз. */
export const BROADCASTS_PAGE = 20

/** Аудитория — фильтры списка гостей без листания и без поиска строкой. */
export const BroadcastAudience = AdminGuestsQuery.omit({
  limit: true,
  offset: true,
  q: true,
})

export type BroadcastAudience = z.infer<typeof BroadcastAudience>

export const BroadcastPreviewInput = z
  .object({
    audience: BroadcastAudience.default({}),
  })
  .strict()

export type BroadcastPreviewInput = z.infer<typeof BroadcastPreviewInput>

export const BroadcastPreview = z
  .object({
    /** Сколько гостей подходит под фильтры. */
    found: z.number().int().nonnegative(),
    /** Из них получат сообщение. */
    willReceive: z.number().int().nonnegative(),
    /** Пропустим: уже получили свои четыре сообщения за месяц. */
    tired: z.number().int().nonnegative(),
    /** Пропустим: некуда слать — гость не связал Telegram. */
    unreachable: z.number().int().nonnegative(),
  })
  .strict()

export type BroadcastPreview = z.infer<typeof BroadcastPreview>

/**
 * Подарок к рассылке: баллы или сертификат из шаблона.
 *
 * ТА ЖЕ ФОРМА, ЧТО У ПОДАРКА КО ДНЮ РОЖДЕНИЯ. Третьего способа дарить не заводим:
 * баллы идут через журнал, сертификат — через общую выдачу промокодов.
 *
 * ПОЛУЧАЕТ КАЖДЫЙ ИЗ СНИМКА АУДИТОРИИ, ОДИН РАЗ — даже тот, до кого сообщение
 * не дошло: подарок лежит на карте и ждёт, а «устал» и «некуда слать» говорят
 * о сообщении, а не о госте. Контрольной группе подарок не выдаётся, как и баллы
 * за покупки: иначе сравнивать программу будет не с чем.
 */
export const BroadcastGift = BirthdayReward

export type BroadcastGift = z.infer<typeof BroadcastGift>

export const CreateBroadcastInput = z
  .object({
    /** Имя для списка рассылок. Гость его не видит. */
    title: z.string().trim().min(2, 'Назовите рассылку').max(BROADCAST_TITLE_MAX),
    text: z
      .string()
      .trim()
      .min(2, 'Напишите текст сообщения')
      .max(BROADCAST_TEXT_MAX, `Не длиннее ${String(BROADCAST_TEXT_MAX)} знаков`),
    audience: BroadcastAudience.default({}),
    /** Момент отправки. Пусто — отправляем сразу. */
    sendAt: z.iso.datetime().optional(),
    /** Подарок каждому из аудитории. Пусто — только сообщение. */
    gift: BroadcastGift.optional(),
  })
  .strict()

export type CreateBroadcastInput = z.infer<typeof CreateBroadcastInput>

export const BroadcastStatus = z.enum(['SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'])
export type BroadcastStatus = z.infer<typeof BroadcastStatus>

export const AdminBroadcast = z
  .object({
    id: z.uuid(),
    title: z.string(),
    text: z.string(),
    audience: BroadcastAudience,
    status: BroadcastStatus,
    sendAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    /** Кто создал — имя сотрудника. null — создано до того, как имена стали писать. */
    author: z.string().nullable(),
    /** Всего получателей в снимке аудитории. */
    total: z.number().int().nonnegative(),
    /** Доставлено. */
    sent: z.number().int().nonnegative(),
    /** Не доставлено: Telegram отказал. */
    failed: z.number().int().nonnegative(),
    /** Пропущено по усталости. */
    tired: z.number().int().nonnegative(),
    /** Пропущено: некуда слать. */
    unreachable: z.number().int().nonnegative(),
    /** Подарок к рассылке. null — только сообщение. */
    gift: BroadcastGift.nullable(),
    /** Сколько подарков уже выдано. Контрольная группа подарков не получает. */
    gifted: z.number().int().nonnegative(),
  })
  .strict()

export type AdminBroadcast = z.infer<typeof AdminBroadcast>

export const AdminBroadcastsList = z
  .object({
    total: z.number().int().nonnegative(),
    items: z.array(AdminBroadcast),
  })
  .strict()

export type AdminBroadcastsList = z.infer<typeof AdminBroadcastsList>

export const AdminBroadcastsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(BROADCASTS_PAGE),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict()

export type AdminBroadcastsQuery = z.infer<typeof AdminBroadcastsQuery>
