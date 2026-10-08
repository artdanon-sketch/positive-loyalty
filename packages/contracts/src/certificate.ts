import { z } from 'zod'

import { GiftValue } from './offer-rules.js'

/**
 * Сертификаты: шаблоны подарков заведения. docs/02, раздел 5.11 · docs/11, У9.
 *
 * Шаблон — «Сертификат на 500 ฿», «Десерт ко дню рождения»: название, что даёт
 * и сколько действует. Выдаётся из карточки гостя через «Подарить» или сам ко дню
 * рождения — обычным промокодом, поэтому гость видит его в приложении, а касса
 * гасит тем же способом, что любой подарок.
 *
 * Хранится акцией вида GIFT_CARD: промокоды, погашение и счётчики «выдано /
 * использовано» уже умеет общая выдача, и третьего способа дарить не появляется.
 */

export const CERTIFICATES_MAX = 50

export const CERTIFICATE_VALIDITY_MAX_DAYS = 365

const CertificateTitle = z.string().trim().min(2).max(80)

const ValidityDays = z.number().int().min(1).max(CERTIFICATE_VALIDITY_MAX_DAYS)

/** Как шаблон лежит в `Offer.reward`. */
export const CertificateOfferReward = z
  .object({
    kind: z.literal('CERTIFICATE'),
    value: GiftValue,
    validityDays: ValidityDays,
  })
  .strict()

export type CertificateOfferReward = z.infer<typeof CertificateOfferReward>

/** Тираж промо — до миллиона штук: больше не раздаёт ни одно заведение. */
export const PROMO_LIMIT_MAX = 1_000_000

/**
 * Условия промо-сертификата: когда его можно забрать и сколько всего штук.
 *
 * ДАТЫ — ЭТО ОКНО «ЗАБРАТЬ», А НЕ СРОК КОДА. Код, взятый в последний день
 * промо, живёт свои validityDays: гость не должен потерять подарок потому, что
 * акция кончилась назавтра после того, как он его взял.
 *
 * ТИРАЖ — ВСЕГО ВЫДАННЫХ ПО ШАБЛОНУ, как totalQty у любой акции: шаблон,
 * которым дарят и ко дню рождения, тратит тот же тираж. Пусто — без ограничения.
 *
 * Хранится в полях самой акции — schedule.startsAt/endsAt и limits.totalQty:
 * промо — надстройка над Offer, а не новая сущность.
 */
export const PromoTerms = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    limit: z.number().int().positive().max(PROMO_LIMIT_MAX).nullable(),
  })
  .strict()
  .refine(
    (terms) =>
      terms.startsAt === null ||
      terms.endsAt === null ||
      Date.parse(terms.startsAt) < Date.parse(terms.endsAt),
    { error: 'Промо не может кончиться раньше, чем начнётся', path: ['endsAt'] },
  )

export type PromoTerms = z.infer<typeof PromoTerms>

/** Без окна и без тиража. */
export const NO_PROMO_TERMS: PromoTerms = { startsAt: null, endsAt: null, limit: null }

export const CertificateTemplate = z
  .object({
    id: z.uuid(),
    title: z.string(),
    /** Что даёт: подарок, скидка суммой или процентом. */
    value: GiftValue,
    /** Сколько дней живёт выданный промокод. */
    validityDays: ValidityDays,
    /** Выключенный шаблон не выдаётся, но выданные по нему промокоды живут свой срок. */
    isActive: z.boolean(),
    /** Промо-сертификат: гость забирает его сам из приложения. */
    selfClaim: z.boolean(),
    /** Когда промо можно забрать и сколько всего штук. Без промо — пустые. */
    promo: PromoTerms,
    issued: z.number().int().nonnegative(),
    redeemed: z.number().int().nonnegative(),
  })
  .strict()

export type CertificateTemplate = z.infer<typeof CertificateTemplate>

export const CreateCertificateInput = z
  .object({
    title: CertificateTitle,
    value: GiftValue,
    validityDays: ValidityDays,
    /** Сразу сделать промо-сертификатом (гость забирает сам). По умолчанию нет. */
    selfClaim: z.boolean().optional(),
    /** Окно и тираж промо. Нет — без ограничений. */
    promo: PromoTerms.optional(),
  })
  .strict()

export type CreateCertificateInput = z.infer<typeof CreateCertificateInput>

export const UpdateCertificateInput = z
  .object({
    title: CertificateTitle.optional(),
    isActive: z.boolean().optional(),
    selfClaim: z.boolean().optional(),
    /** Заменить окно и тираж промо целиком. */
    promo: PromoTerms.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Нечего менять: не передано ни одного поля',
  })

export type UpdateCertificateInput = z.infer<typeof UpdateCertificateInput>

/**
 * Промо-сертификат в приложении гостя — то, что он может забрать сам.
 *
 * Приезжает списком по всем заведениям, где гость участвует. `claimed` — уже
 * ли взят этим гостём: кнопка «Забрать» тогда гаснет, а промокод лежит в кошельке.
 */
export const PromoCertificate = z
  .object({
    offerId: z.uuid(),
    tenantId: z.string(),
    venue: z.string(),
    title: z.string(),
    value: GiftValue,
    validityDays: ValidityDays,
    howTo: z.array(z.string()),
    claimed: z.boolean(),
    /** До какого момента можно забрать. null — без срока. */
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    /** Сколько осталось. null — тиража нет. */
    left: z.number().int().nonnegative().nullable(),
  })
  .strict()

export type PromoCertificate = z.infer<typeof PromoCertificate>

/** Витрина промо-сертификатов гостя — по всем его заведениям. */
export const PromoCertificateList = z.array(PromoCertificate)

export type PromoCertificateList = z.infer<typeof PromoCertificateList>

/** Ответ на «Забрать»: выданный промокод. Повторное получение возвращает тот же. */
export const ClaimedPromoCertificate = z
  .object({
    offerId: z.uuid(),
    code: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strict()

export type ClaimedPromoCertificate = z.infer<typeof ClaimedPromoCertificate>
