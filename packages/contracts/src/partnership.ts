import { z } from 'zod'

/**
 * Партнёрства между заведениями: триггеры и награды. docs/07, раздел 4.
 *
 * Здесь описано ЧТО должно случиться у заведения-источника и ЧТО за это
 * получит гость у заведения-донора. Обе стороны согласовывают именно эти
 * два объекта — поэтому они и живут в контрактах, а не в коде одного модуля.
 */

/**
 * Что должно произойти у заведения-источника.
 *
 * Разбор по полю `type` (discriminatedUnion), а не по набору необязательных
 * полей: иначе условие «покупка от 5000» и условие «третий визит» отличались бы
 * лишь тем, какое поле заполнено, и опечатка молча превращала бы одно в другое.
 */
export const PartnershipTrigger = z.discriminatedUnion('type', [
  /** Чек не меньше суммы. Сумма в минорных единицах (сатангах). */
  z.object({ type: z.literal('ON_PURCHASE'), minAmount: z.number().int().min(0) }),
  /** Первый визит гостя в это заведение. */
  z.object({ type: z.literal('ON_FIRST_VISIT') }),
  /** N-й визит. Со второго: первый — это ON_FIRST_VISIT. */
  z.object({ type: z.literal('ON_NTH_VISIT'), n: z.number().int().min(2) }),
  /**
   * Купил определённый вид: абонемент, курс, недельную аренду.
   *
   * ЭТО И ЕСТЬ ГОЛОВНОЙ ПРИМЕР ТЗ — «клиент купил абонемент на 5 000 ฿».
   * Раньше здесь стояло ON_PACKAGE_PURCHASE, отличавшееся от ON_PURCHASE
   * происхождением записи в журнале. Сработать оно не могло никогда: журнал
   * знает только чеки, и «абонемент» в нём ничем не помечался.
   *
   * saleKindId принадлежит заведению-ИСТОЧНИКУ: это его список видов
   * продаж. Донор видит название по двусторонней политике партнёрства —
   * иначе соглашался бы вслепую на идентификатор.
   */
  z.object({
    type: z.literal('ON_SALE_KIND'),
    saleKindId: z.uuid(),
    /** Порог суммы. Ноль — любой абонемент, хоть пробный. */
    minAmount: z.number().int().min(0).default(0),
  }),
  /** Закрыл штамп-карту. */
  z.object({ type: z.literal('ON_STAMP_COMPLETE') }),
  /** Достиг статуса. */
  z.object({ type: z.literal('ON_TIER_REACHED'), tierId: z.string().min(1) }),
  /** Просто стал гостем партнёра. */
  z.object({ type: z.literal('ON_MEMBERSHIP') }),
])

export type PartnershipTrigger = z.infer<typeof PartnershipTrigger>

/**
 * Что гость получит у заведения-донора.
 *
 * Все суммы — целые в минорных единицах (железное правило 4). Награду
 * оплачивает тот, кто её даёт: расчётов между заведениями нет никогда.
 */
export const PartnershipReward = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FREE_ITEM'),
    itemName: z.string().min(1).max(200),
    /** Минимальный чек, при котором подарок выдаётся. */
    minCheck: z.number().int().min(0).default(0),
  }),
  z.object({ kind: z.literal('FIXED_POINTS'), amount: z.number().int().positive() }),
  z.object({
    kind: z.literal('PERCENT_OFF'),
    percent: z.number().min(1).max(100),
    /** Потолок скидки. null — без потолка. */
    maxDiscount: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: z.literal('FIXED_OFF'),
    amount: z.number().int().positive(),
    minCheck: z.number().int().min(0).default(0),
  }),
  z.object({ kind: z.literal('GIFT_STAMPS'), count: z.number().int().min(1) }),
])

export type PartnershipReward = z.infer<typeof PartnershipReward>

/**
 * Ограничения условия.
 *
 * `dailyCap` — не украшение. Без него заведение-источник проводит акцию
 * и присылает донору двести человек за бесплатными роллами за один день
 * (docs/07, раздел 4.3).
 */
export const PartnershipLimits = z
  .object({
    /** Сколько всего промокодов выдать по этому условию. null — без ограничения. */
    totalGrants: z.number().int().positive().nullable().default(null),
    /** Сколько раз один и тот же гость может получить награду. */
    perGuest: z.number().int().positive().default(1),
    /** Сколько промокодов в сутки. null — без ограничения. */
    dailyCap: z.number().int().positive().nullable().default(null),
  })
  .strict()

export type PartnershipLimits = z.infer<typeof PartnershipLimits>

// ─── Договориться: каталог, приглашение, партнёрство ─────────────────────────

export const PartnershipStatus = z.enum([
  'PROPOSED',
  'NEGOTIATING',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'DECLINED',
])

export type PartnershipStatus = z.infer<typeof PartnershipStatus>

export const VenueVertical = z.enum(['RESTAURANT', 'SPA', 'RENTAL', 'RETAIL', 'OTHER'])
export type VenueVertical = z.infer<typeof VenueVertical>

/**
 * Заведение сети, как его видит другое заведение. docs/07, раздел 6.3.
 *
 * Только витрина. Выручки, среднего чека, настроек программы и точного размера
 * базы здесь нет и не будет: это чужие коммерческие данные.
 */
export const NetworkVenue = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string(),
    vertical: VenueVertical,
    /** Гостей, округлённо вниз до сотен. 0 — меньше сотни. */
    guestsApprox: z.number().int().nonnegative(),
    /** Наше партнёрство с этим заведением, если оно есть. */
    partnership: z.object({ id: z.uuid(), status: PartnershipStatus }).strict().nullable(),
  })
  .strict()

export type NetworkVenue = z.infer<typeof NetworkVenue>

export const PartnerCatalog = z.object({ items: z.array(NetworkVenue) }).strict()
export type PartnerCatalog = z.infer<typeof PartnerCatalog>

/** Бесплатные приглашения на сегодня — по часам заведения, а не сервера. */
export const InviteQuotaView = z
  .object({
    freeLimit: z.number().int().nonnegative(),
    freeUsed: z.number().int().nonnegative(),
    freeLeft: z.number().int().nonnegative(),
  })
  .strict()

export type InviteQuotaView = z.infer<typeof InviteQuotaView>

export const INVITE_TEXT_MIN = 40
export const INVITE_TEXT_MAX = 2000

/**
 * Приглашение к партнёрству.
 *
 * Текст обязателен и не короче сорока знаков (docs/07, раздел 6.2): «привет»
 * не приглашение, а спам. Сорок знаков — это «кто вы и что предлагаете».
 */
export const CreateInviteInput = z
  .object({
    partnerTenantId: z.uuid(),
    text: z
      .string()
      .trim()
      .min(INVITE_TEXT_MIN, `Напишите хотя бы ${INVITE_TEXT_MIN} знаков: кто вы и что предлагаете`)
      .max(INVITE_TEXT_MAX),
  })
  .strict()

export type CreateInviteInput = z.infer<typeof CreateInviteInput>

export const CreateInviteResult = z
  .object({ partnershipId: z.uuid(), quota: InviteQuotaView })
  .strict()

export type CreateInviteResult = z.infer<typeof CreateInviteResult>

export const PartnershipListQuery = z.object({ status: PartnershipStatus.optional() }).strict()
export type PartnershipListQuery = z.infer<typeof PartnershipListQuery>

/** Причина отказа, завершения или блокировки. Необязательна: объясняться никто не обязан. */
export const PartnershipReasonInput = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict()

export type PartnershipReasonInput = z.infer<typeof PartnershipReasonInput>

export const SendPartnershipMessageInput = z
  .object({ text: z.string().trim().min(1).max(INVITE_TEXT_MAX) })
  .strict()

export type SendPartnershipMessageInput = z.infer<typeof SendPartnershipMessageInput>

/** Вторая сторона. Имя может отсутствовать, если заведение удалено из сети. */
export const PartnerSide = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string().nullable(),
    vertical: VenueVertical.nullable(),
  })
  .strict()

export type PartnerSide = z.infer<typeof PartnerSide>

export const PartnershipSummary = z
  .object({
    id: z.uuid(),
    status: PartnershipStatus,
    /** Кто начал: мы пригласили (OUTGOING) или нас (INCOMING). */
    direction: z.enum(['OUTGOING', 'INCOMING']),
    partner: PartnerSide,
    proposedAt: z.iso.datetime(),
    /** Когда приглашение приняли к обсуждению. */
    acceptedAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    /** Действующие условия: сколько подарков даём мы и сколько дают нам. */
    activeTerms: z
      .object({
        weGive: z.number().int().nonnegative(),
        theyGive: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export type PartnershipSummary = z.infer<typeof PartnershipSummary>

/** Сначала то, что ждёт нашего ответа, потом живое, в конце — завершённое. */
export const PartnershipList = z.object({ items: z.array(PartnershipSummary) }).strict()
export type PartnershipList = z.infer<typeof PartnershipList>

export const PartnershipMessageView = z
  .object({
    id: z.uuid(),
    kind: z.enum(['INVITE', 'TEXT', 'TERM_PROPOSED', 'TERM_ACCEPTED', 'TERM_REJECTED', 'SYSTEM']),
    fromUs: z.boolean(),
    text: z.string(),
    /** Язык оригинала. Перевод появится вместе с переводчиком (docs/07, раздел 7). */
    sourceLang: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type PartnershipMessageView = z.infer<typeof PartnershipMessageView>

/**
 * Что с партнёрством можно сделать прямо сейчас.
 *
 * РЕШАЕТ СЕРВЕР, А НЕ ЭКРАН. Правило «ответить на приглашение может только
 * приглашённый» живёт в одном месте; экран показывает кнопки по этому списку
 * и не пересказывает правила своими словами, рискуя их переврать.
 */
export const PartnershipActions = z
  .object({
    accept: z.boolean(),
    decline: z.boolean(),
    end: z.boolean(),
    block: z.boolean(),
    message: z.boolean(),
  })
  .strict()

export type PartnershipActions = z.infer<typeof PartnershipActions>

export const PartnershipDetail = PartnershipSummary.extend({
  endReason: z.string().nullable(),
  /** Последние сообщения, старые сверху — как в чате. */
  messages: z.array(PartnershipMessageView),
  actions: PartnershipActions,
}).strict()

export type PartnershipDetail = z.infer<typeof PartnershipDetail>
