import type { GiftValue, OfferI18n, OfferLimits, OfferReward } from '@positive/contracts'

/**
 * Тексты акции из конструктора. Та же задача, что у партнёрской акции
 * (partnerships/term-texts.ts): гость видит их в кошельке, кассир — при
 * погашении, владелец — в списке акций.
 *
 * НАЗВАНИЕ — СЛОВАМИ ВЛАДЕЛЬЦА И НЕ ПЕРЕВОДИТСЯ. «Вернём 200 ฿» написал человек;
 * перевод таких строк появится вместе с переводчиком (docs/07, раздел 7).
 *
 * ШАГИ — ДЛЯ ГОСТЯ У СТОЙКИ: что показать, что это даёт, сколько живёт. Условие,
 * за которое код выдали, в шаги промокода не входит: гость, увидевший под кодом
 * «за чек от 800 ฿», решит, что тратить 800 ฿ надо ещё раз.
 */

type Lang = 'ru' | 'en'

const NUMBER_LOCALE: Readonly<Record<Lang, string>> = { ru: 'ru-RU', en: 'en-US' }

const baht = (minor: number, lang: Lang): string =>
  `${new Intl.NumberFormat(NUMBER_LOCALE[lang], { maximumFractionDigits: 2 }).format(minor / 100)} ฿`

/** «1 день, 3 дня, 14 дней, 21 день». */
const daysRu = (count: number): string => {
  const tens = count % 100
  const units = count % 10

  if (units === 1 && tens !== 11) {
    return `${String(count)} день`
  }

  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) {
    return `${String(count)} дня`
  }

  return `${String(count)} дней`
}

const giftLine = (gift: GiftValue, lang: Lang): string => {
  switch (gift.kind) {
    case 'FREE_ITEM':
      return lang === 'ru' ? `${gift.itemName} в подарок` : `${gift.itemName} as a gift`
    case 'FIXED_OFF':
      return lang === 'ru' ? `Скидка ${baht(gift.amount, lang)}` : `${baht(gift.amount, lang)} off`
    case 'PERCENT_OFF': {
      const percent = String(gift.percent)

      if (gift.maxDiscount === null) {
        return lang === 'ru' ? `Скидка ${percent}%` : `${percent}% off`
      }

      return lang === 'ru'
        ? `Скидка ${percent}%, но не больше ${baht(gift.maxDiscount, lang)}`
        : `${percent}% off, up to ${baht(gift.maxDiscount, lang)}`
    }
  }
}

const steps = (reward: OfferReward, limits: OfferLimits, lang: Lang): string[] => {
  if (reward.kind === 'GIFT_CODE') {
    return [
      lang === 'ru' ? 'Покажите код на кассе' : 'Show the code at the till',
      giftLine(reward.gift, lang),
      lang === 'ru'
        ? `Действует ${daysRu(reward.validityDays)} с выдачи`
        : `Valid for ${String(reward.validityDays)} day${reward.validityDays === 1 ? '' : 's'}`,
    ]
  }

  const minCheck = limits.minCheck ?? null

  return [
    lang === 'ru'
      ? `Кэшбэк ${String(reward.percent)}% баллами — начисляется к чеку сам`
      : `${String(reward.percent)}% cashback in points — added to the receipt automatically`,
    ...(minCheck === null
      ? []
      : [
          lang === 'ru'
            ? `При чеке от ${baht(minCheck, lang)}`
            : `With a check of ${baht(minCheck, lang)} or more`,
        ]),
  ]
}

export const engineOfferTexts = (input: {
  readonly title: string
  readonly reward: OfferReward
  readonly limits: OfferLimits
}): OfferI18n => ({
  title: { ru: input.title, en: input.title },
  howTo: {
    ru: steps(input.reward, input.limits, 'ru'),
    en: steps(input.reward, input.limits, 'en'),
  },
})
