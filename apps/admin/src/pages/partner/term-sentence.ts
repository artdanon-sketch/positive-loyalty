import type {
  PartnershipLimits,
  PartnershipReward,
  PartnershipTrigger,
  TermDirection,
} from '@positive/contracts'

import { fill } from '../../shared/format/fill'
import type { TranslationKey } from '../../shared/i18n'

/**
 * Условие партнёрства одной фразой. docs/10, раздел 5.4:
 *
 *   За «Абонемент на месяц» от 5 000 ฿ у Dance Studio — мы дарим
 *   «Ролл Филадельфия» при чеке от 800 ฿.
 *
 * ФРАЗА, А НЕ ТАБЛИЦА ПОЛЕЙ. Владелец кафе соглашается на сделку, которую
 * можно пересказать соседу за стойкой. «Триггер: ON_SALE_KIND, minAmount:
 * 500000» он пересказать не сможет — и либо откажется, либо согласится вслепую.
 *
 * Одна и та же функция рисует и предложенное условие, и живой пример
 * в конструкторе: то, что владелец видит, пока заполняет форму, — ровно
 * то, что увидит партнёр.
 */

type Translate = (key: TranslationKey) => string

export interface TermForSentence {
  readonly direction: TermDirection
  readonly trigger: PartnershipTrigger
  readonly reward: PartnershipReward
  readonly validityDays: number
  readonly limits: PartnershipLimits
  readonly saleKindName: string | null
}

/** Баты без копеек, если их нет: «5 000 ฿», а не «5 000,00 ฿» — во фразе копейки шумят. */
export const bahtShort = (minor: number): string =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(minor / 100)} ฿`

const triggerPhrase = (
  trigger: PartnershipTrigger,
  saleKindName: string | null,
  t: Translate,
): string => {
  switch (trigger.type) {
    case 'ON_PURCHASE':
      return trigger.minAmount > 0
        ? fill(t('term.trigger.purchase'), { amount: bahtShort(trigger.minAmount) })
        : t('term.trigger.anyPurchase')
    case 'ON_SALE_KIND': {
      const name = fill(t('term.trigger.saleKind'), {
        name: saleKindName ?? t('term.trigger.saleKindUnknown'),
      })
      return trigger.minAmount > 0
        ? `${name} ${fill(t('term.trigger.from'), { amount: bahtShort(trigger.minAmount) })}`
        : name
    }
    case 'ON_FIRST_VISIT':
      return t('term.trigger.firstVisit')
    case 'ON_NTH_VISIT':
      return fill(t('term.trigger.nthVisit'), { n: trigger.n })
    case 'ON_MEMBERSHIP':
      return t('term.trigger.membership')
    case 'ON_STAMP_COMPLETE':
      return t('term.trigger.stamps')
    case 'ON_TIER_REACHED':
      return t('term.trigger.tier')
  }
}

const rewardPhrase = (reward: PartnershipReward, t: Translate): string => {
  const withCheck = (base: string, minCheck: number): string =>
    minCheck > 0
      ? `${base} ${fill(t('term.reward.minCheck'), { amount: bahtShort(minCheck) })}`
      : base

  switch (reward.kind) {
    case 'FREE_ITEM':
      return withCheck(fill(t('term.reward.item'), { name: reward.itemName }), reward.minCheck)
    case 'PERCENT_OFF': {
      const base = fill(t('term.reward.percent'), { percent: reward.percent })
      return reward.maxDiscount === null
        ? base
        : `${base} ${fill(t('term.reward.upTo'), { amount: bahtShort(reward.maxDiscount) })}`
    }
    case 'FIXED_OFF':
      return withCheck(
        fill(t('term.reward.fixed'), { amount: bahtShort(reward.amount) }),
        reward.minCheck,
      )
    case 'FIXED_POINTS':
      return fill(t('term.reward.points'), { amount: reward.amount })
    case 'GIFT_STAMPS':
      return fill(t('term.reward.stamps'), { count: reward.count })
  }
}

export const describeTerm = (
  term: TermForSentence,
  partnerName: string,
  t: Translate,
): { sentence: string; limits: string } => {
  const template =
    term.direction === 'WE_GIVE' ? t('term.sentence.weGive') : t('term.sentence.theyGive')

  const sentence = fill(template, {
    trigger: triggerPhrase(term.trigger, term.saleKindName, t),
    partner: partnerName,
    reward: rewardPhrase(term.reward, t),
  })

  const limits = [
    fill(t('term.limits.validity'), { days: term.validityDays }),
    term.limits.totalGrants === null
      ? null
      : fill(t('term.limits.total'), { n: term.limits.totalGrants }),
    term.limits.dailyCap === null
      ? null
      : fill(t('term.limits.daily'), { n: term.limits.dailyCap }),
    fill(t('term.limits.perGuest'), { n: term.limits.perGuest }),
  ]
    .filter((part): part is string => part !== null)
    .join(' ')

  return { sentence, limits }
}
