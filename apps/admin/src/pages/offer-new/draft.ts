import type {
  CreateOfferInput,
  GiftValue,
  OfferAudience,
  OfferLimits,
  OfferReward,
  OfferSchedule,
  SimulateOfferInput,
} from '@positive/contracts'

import { bahtToMinor } from '../../shared/format/baht-input'

/**
 * Черновик акции в конструкторе и его перевод в правила. docs/03, раздел 4 · docs/11, У2.
 *
 * ПОЛЯ — СТРОКИ, ПРАВИЛА — ЧИСЛА. Владелец вводит «800» и стирает поле до пустого;
 * пустое поле — это «без порога», а не ноль. В сатанги суммы переводятся только
 * здесь, одним местом (железное правило 4).
 *
 * ОДНА ПРОБЛЕМА, А НЕ СПИСОК. Под формой одна строка «что поправить» — первая
 * по порядку полей, — и «Дальше» ждёт, пока её не станет. Сервер проверяет те же
 * правила сам: здесь подсказка, а не защита.
 *
 * ДАТЫ — ПО ЧАСАМ ПХУКЕТА. Все заведения сети в поясе +07:00 без летнего времени:
 * «конец 20 сентября» — до 23:59:59 этого дня по местным часам. Заведению в другом
 * поясе понадобится сдвиг из его настроек.
 */

export type TemplateId = 'RETURN_TOMORROW' | 'QUIET_HOURS' | 'WAKE_SLEEPING' | 'WELCOME' | 'CUSTOM'

export const TEMPLATE_IDS: readonly TemplateId[] = [
  'RETURN_TOMORROW',
  'QUIET_HOURS',
  'WAKE_SLEEPING',
  'WELCOME',
  'CUSTOM',
]

export type DraftType = 'PROMO_ON_CHECK' | 'CASHBACK'
export type GiftKind = GiftValue['kind']
export type AudienceKind = OfferAudience['kind']

export interface OfferDraft {
  readonly type: DraftType
  readonly title: string
  readonly audience: AudienceKind
  readonly sleepingDays: string
  readonly cashbackPercent: string
  readonly giftKind: GiftKind
  /** Баты, как их пишет человек: «200», «199,50». */
  readonly giftAmount: string
  readonly giftPercent: string
  /** Пусто — без потолка. */
  readonly giftMaxDiscount: string
  readonly giftItem: string
  readonly validityDays: string
  /** Пусто — без порога. */
  readonly minCheck: string
  readonly perGuestQty: string
  readonly totalQty: string
  /** ISO: 1 — понедельник. Пусто — каждый день. */
  readonly weekdays: readonly number[]
  readonly timeFrom: string
  readonly timeTo: string
  /** ГГГГ-ММ-ДД из поля даты. */
  readonly startsOn: string
  readonly endsOn: string
}

export type DraftProblem =
  | 'title'
  | 'cashbackPercent'
  | 'giftAmount'
  | 'giftPercent'
  | 'giftMaxDiscount'
  | 'giftItem'
  | 'validityDays'
  | 'sleepingDays'
  | 'minCheck'
  | 'perGuestQty'
  | 'totalQty'
  | 'timeWindow'
  | 'period'

export type RulesCheck =
  | { readonly ok: true; readonly rules: SimulateOfferInput }
  | { readonly ok: false; readonly problem: DraftProblem }

export type OfferCheck =
  | { readonly ok: true; readonly offer: CreateOfferInput }
  | { readonly ok: false; readonly problem: DraftProblem }

const BLANK: OfferDraft = {
  type: 'PROMO_ON_CHECK',
  title: '',
  audience: 'ALL',
  sleepingDays: '30',
  cashbackPercent: '10',
  giftKind: 'FIXED_OFF',
  giftAmount: '',
  giftPercent: '10',
  giftMaxDiscount: '',
  giftItem: '',
  validityDays: '14',
  minCheck: '',
  perGuestQty: '1',
  totalQty: '',
  weekdays: [],
  timeFrom: '',
  timeTo: '',
  startsOn: '',
  endsOn: '',
}

/** Слова шаблона — на языке экрана, их даёт вызывающий. */
export interface TemplateWords {
  readonly title: string
  readonly item: string
}

/**
 * Шаблоны — только то, что касса уже считает: промокод за чек и кэшбэк.
 * Карта визитов и ваучер сети появятся вместе со своими механиками.
 */
export const templateDraft = (id: TemplateId, words: TemplateWords): OfferDraft => {
  switch (id) {
    case 'RETURN_TOMORROW':
      return {
        ...BLANK,
        title: words.title,
        giftAmount: '200',
        minCheck: '800',
        perGuestQty: '1',
        validityDays: '1',
      }
    case 'QUIET_HOURS':
      return {
        ...BLANK,
        type: 'CASHBACK',
        title: words.title,
        cashbackPercent: '10',
        weekdays: [1, 2, 3, 4],
        timeFrom: '14:00',
        timeTo: '17:00',
      }
    case 'WAKE_SLEEPING':
      return {
        ...BLANK,
        type: 'CASHBACK',
        title: words.title,
        cashbackPercent: '15',
        audience: 'SLEEPING',
        sleepingDays: '30',
      }
    case 'WELCOME':
      return {
        ...BLANK,
        title: words.title,
        audience: 'NEW',
        giftKind: 'FREE_ITEM',
        giftItem: words.item,
        perGuestQty: '1',
        validityDays: '14',
      }
    case 'CUSTOM':
      return BLANK
  }
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PHUKET_OFFSET = '+07:00'

const blank = (value: string): boolean => value.trim() === ''

const wholeIn = (value: string, min: number, max: number): number | null => {
  const trimmed = value.trim()

  if (!/^\d{1,6}$/.test(trimmed)) {
    return null
  }

  const number = Number(trimmed)

  return number >= min && number <= max ? number : null
}

const draftGift = (draft: OfferDraft): GiftValue | DraftProblem => {
  switch (draft.giftKind) {
    case 'FIXED_OFF': {
      const amount = bahtToMinor(draft.giftAmount)
      return amount === null ? 'giftAmount' : { kind: 'FIXED_OFF', amount }
    }
    case 'PERCENT_OFF': {
      const percent = wholeIn(draft.giftPercent, 1, 100)

      if (percent === null) {
        return 'giftPercent'
      }

      if (blank(draft.giftMaxDiscount)) {
        return { kind: 'PERCENT_OFF', percent, maxDiscount: null }
      }

      const maxDiscount = bahtToMinor(draft.giftMaxDiscount)
      return maxDiscount === null
        ? 'giftMaxDiscount'
        : { kind: 'PERCENT_OFF', percent, maxDiscount }
    }
    case 'FREE_ITEM': {
      const itemName = draft.giftItem.trim()
      return itemName === '' || itemName.length > 200 ? 'giftItem' : { kind: 'FREE_ITEM', itemName }
    }
  }
}

/** Награда — отдельно от остального: превью показывает её, даже пока расписание не дописано. */
export const draftReward = (draft: OfferDraft): OfferReward | DraftProblem => {
  if (draft.type === 'CASHBACK') {
    const percent = wholeIn(draft.cashbackPercent, 1, 50)
    return percent === null ? 'cashbackPercent' : { kind: 'EARN_PERCENT', percent }
  }

  const gift = draftGift(draft)

  if (typeof gift === 'string') {
    return gift
  }

  const validityDays = wholeIn(draft.validityDays, 1, 90)

  return validityDays === null ? 'validityDays' : { kind: 'GIFT_CODE', gift, validityDays }
}

const draftAudience = (draft: OfferDraft): OfferAudience | DraftProblem => {
  if (draft.audience !== 'SLEEPING') {
    return { kind: draft.audience }
  }

  const notVisitedDays = wholeIn(draft.sleepingDays, 7, 365)

  return notVisitedDays === null ? 'sleepingDays' : { kind: 'SLEEPING', notVisitedDays }
}

export const draftLimits = (draft: OfferDraft): OfferLimits | DraftProblem => {
  const limits: { minCheck?: number; perGuestQty?: number; totalQty?: number } = {}

  if (!blank(draft.minCheck)) {
    const minCheck = bahtToMinor(draft.minCheck)

    if (minCheck === null) {
      return 'minCheck'
    }

    limits.minCheck = minCheck
  }

  // Лимиты выдач — только у промокода: кэшбэк кодов не выдаёт, и касса их у него не читает.
  if (draft.type === 'PROMO_ON_CHECK') {
    if (!blank(draft.perGuestQty)) {
      const perGuestQty = wholeIn(draft.perGuestQty, 1, 100_000)

      if (perGuestQty === null) {
        return 'perGuestQty'
      }

      limits.perGuestQty = perGuestQty
    }

    if (!blank(draft.totalQty)) {
      const totalQty = wholeIn(draft.totalQty, 1, 100_000)

      if (totalQty === null) {
        return 'totalQty'
      }

      limits.totalQty = totalQty
    }
  }

  return limits
}

const draftSchedule = (draft: OfferDraft): OfferSchedule | DraftProblem => {
  const schedule: {
    startsAt?: string
    endsAt?: string
    weekdays?: number[]
    timeWindow?: { from: string; to: string }
  } = {}

  const days = [...new Set(draft.weekdays)]
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b)

  // Все семь дней — то же, что никакого ограничения: лишнего не храним.
  if (days.length > 0 && days.length < 7) {
    schedule.weekdays = days
  }

  const from = draft.timeFrom.trim()
  const to = draft.timeTo.trim()

  if (from !== '' || to !== '') {
    if (!CLOCK.test(from) || !CLOCK.test(to) || from === to) {
      return 'timeWindow'
    }

    schedule.timeWindow = { from, to }
  }

  const startsOn = draft.startsOn.trim()
  const endsOn = draft.endsOn.trim()

  if (startsOn !== '') {
    if (!DATE.test(startsOn)) {
      return 'period'
    }

    schedule.startsAt = `${startsOn}T00:00:00${PHUKET_OFFSET}`
  }

  if (endsOn !== '') {
    if (!DATE.test(endsOn)) {
      return 'period'
    }

    schedule.endsAt = `${endsOn}T23:59:59${PHUKET_OFFSET}`
  }

  if (
    schedule.startsAt !== undefined &&
    schedule.endsAt !== undefined &&
    Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)
  ) {
    return 'period'
  }

  return schedule
}

/** Правила без названия — для прогноза. Проверки — в порядке полей формы. */
export const draftRules = (draft: OfferDraft): RulesCheck => {
  const reward = draftReward(draft)

  if (typeof reward === 'string') {
    return { ok: false, problem: reward }
  }

  const audience = draftAudience(draft)

  if (typeof audience === 'string') {
    return { ok: false, problem: audience }
  }

  const limits = draftLimits(draft)

  if (typeof limits === 'string') {
    return { ok: false, problem: limits }
  }

  const schedule = draftSchedule(draft)

  if (typeof schedule === 'string') {
    return { ok: false, problem: schedule }
  }

  return { ok: true, rules: { type: draft.type, audience, schedule, limits, reward } }
}

/** Акция целиком — для запуска или черновика. Название проверяется первым: оно первое в форме. */
export const draftOffer = (draft: OfferDraft, launch: 'NOW' | 'DRAFT'): OfferCheck => {
  const title = draft.title.trim()

  if (title.length < 2 || title.length > 80) {
    return { ok: false, problem: 'title' }
  }

  const rules = draftRules(draft)

  if (!rules.ok) {
    return rules
  }

  return { ok: true, offer: { ...rules.rules, title, stackable: true, priority: 100, launch } }
}
