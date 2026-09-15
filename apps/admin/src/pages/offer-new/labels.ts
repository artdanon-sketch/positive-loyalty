import type { TranslationKey } from '../../shared/i18n'
import type { AudienceKind, DraftProblem, DraftType, GiftKind, TemplateId } from './draft'

/** Подписи конструктора: одни и те же в форме, в сводке перед запуском и в шаблонах. */

export const TEMPLATE_LABELS: Readonly<
  Record<
    TemplateId,
    {
      readonly name: TranslationKey
      readonly caption: TranslationKey
      /** Название, которое шаблон подставит в форму. У «своей» — пусто. */
      readonly title: TranslationKey | null
    }
  >
> = {
  RETURN_TOMORROW: {
    name: 'offerNew.template.RETURN_TOMORROW.name',
    caption: 'offerNew.template.RETURN_TOMORROW.caption',
    title: 'offerNew.template.RETURN_TOMORROW.title',
  },
  QUIET_HOURS: {
    name: 'offerNew.template.QUIET_HOURS.name',
    caption: 'offerNew.template.QUIET_HOURS.caption',
    title: 'offerNew.template.QUIET_HOURS.title',
  },
  WAKE_SLEEPING: {
    name: 'offerNew.template.WAKE_SLEEPING.name',
    caption: 'offerNew.template.WAKE_SLEEPING.caption',
    title: 'offerNew.template.WAKE_SLEEPING.title',
  },
  WELCOME: {
    name: 'offerNew.template.WELCOME.name',
    caption: 'offerNew.template.WELCOME.caption',
    title: 'offerNew.template.WELCOME.title',
  },
  CUSTOM: {
    name: 'offerNew.template.CUSTOM.name',
    caption: 'offerNew.template.CUSTOM.caption',
    title: null,
  },
}

export const TYPE_LABELS: Readonly<Record<DraftType, TranslationKey>> = {
  PROMO_ON_CHECK: 'offerNew.type.PROMO_ON_CHECK',
  CASHBACK: 'offerNew.type.CASHBACK',
}

export const GIFT_LABELS: Readonly<Record<GiftKind, TranslationKey>> = {
  FIXED_OFF: 'offerNew.gift.FIXED_OFF',
  PERCENT_OFF: 'offerNew.gift.PERCENT_OFF',
  FREE_ITEM: 'offerNew.gift.FREE_ITEM',
}

export const AUDIENCE_LABELS: Readonly<Record<AudienceKind, TranslationKey>> = {
  ALL: 'offerNew.audience.ALL',
  NEW: 'offerNew.audience.NEW',
  TOURIST: 'offerNew.audience.TOURIST',
  RESIDENT: 'offerNew.audience.RESIDENT',
  SLEEPING: 'offerNew.audience.SLEEPING',
}

export const WEEKDAYS: ReadonlyArray<{ readonly day: number; readonly label: TranslationKey }> = [
  { day: 1, label: 'offerNew.weekday.1' },
  { day: 2, label: 'offerNew.weekday.2' },
  { day: 3, label: 'offerNew.weekday.3' },
  { day: 4, label: 'offerNew.weekday.4' },
  { day: 5, label: 'offerNew.weekday.5' },
  { day: 6, label: 'offerNew.weekday.6' },
  { day: 7, label: 'offerNew.weekday.7' },
]

export const PROBLEM_LABELS: Readonly<Record<DraftProblem, TranslationKey>> = {
  title: 'offerNew.problem.title',
  cashbackPercent: 'offerNew.problem.cashbackPercent',
  giftAmount: 'offerNew.problem.giftAmount',
  giftPercent: 'offerNew.problem.giftPercent',
  giftMaxDiscount: 'offerNew.problem.giftMaxDiscount',
  giftItem: 'offerNew.problem.giftItem',
  validityDays: 'offerNew.problem.validityDays',
  sleepingDays: 'offerNew.problem.sleepingDays',
  minCheck: 'offerNew.problem.minCheck',
  perGuestQty: 'offerNew.problem.perGuestQty',
  totalQty: 'offerNew.problem.totalQty',
  timeWindow: 'offerNew.problem.timeWindow',
  period: 'offerNew.problem.period',
}
