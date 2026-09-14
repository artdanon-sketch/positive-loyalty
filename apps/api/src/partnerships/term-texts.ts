import type { OfferI18n, PartnershipReward } from '@positive/contracts'

/**
 * Тексты акции, которую рождает принятое условие партнёрства.
 *
 * Их читают трое: гость в кошельке («Ролл Филадельфия в подарок»), кассир
 * при погашении — ему важнее всего условие «к заказу от 800 ฿», — и владелец
 * в списке акций. Поэтому условие подарка идёт отдельным шагом, а не прячется
 * в названии.
 *
 * СОБИРАЕТСЯ НА СЕРВЕРЕ, ОДИН РАЗ, ПРИ АКТИВАЦИИ. Клиенты показывают готовое:
 * иначе кошелёк, касса и бэк-офис разошлись бы в формулировках на четырёх
 * языках (docs/02, раздел 2.1).
 *
 * `itemName` не переводится — это единственная строка, которую написал
 * человек. Перевод таких строк появится вместе с переводчиком (docs/07,
 * раздел 7); до тех пор английский гость увидит название на языке меню.
 */

type Lang = 'ru' | 'en'

const NUMBER_LOCALE: Readonly<Record<Lang, string>> = { ru: 'ru-RU', en: 'en-US' }

const baht = (minor: number, lang: Lang): string =>
  `${new Intl.NumberFormat(NUMBER_LOCALE[lang], { maximumFractionDigits: 2 }).format(minor / 100)} ฿`

const number = (value: number, lang: Lang): string =>
  new Intl.NumberFormat(NUMBER_LOCALE[lang], { maximumFractionDigits: 2 }).format(value)

const title = (reward: PartnershipReward, lang: Lang): string => {
  switch (reward.kind) {
    case 'FREE_ITEM':
      return lang === 'ru' ? `${reward.itemName} в подарок` : `${reward.itemName} as a gift`
    case 'PERCENT_OFF':
      return lang === 'ru'
        ? `Скидка ${number(reward.percent, lang)}%`
        : `${number(reward.percent, lang)}% off`
    case 'FIXED_OFF':
      return lang === 'ru'
        ? `Скидка ${baht(reward.amount, lang)}`
        : `${baht(reward.amount, lang)} off`
    case 'FIXED_POINTS':
      return lang === 'ru'
        ? `${number(reward.amount, lang)} баллов в подарок`
        : `${number(reward.amount, lang)} bonus points`
    case 'GIFT_STAMPS':
      return lang === 'ru'
        ? `${number(reward.count, lang)} штампов в подарок`
        : `${number(reward.count, lang)} bonus stamps`
  }
}

const condition = (reward: PartnershipReward, lang: Lang): string | null => {
  switch (reward.kind) {
    case 'FREE_ITEM':
    case 'FIXED_OFF':
      if (reward.minCheck <= 0) {
        return null
      }
      return lang === 'ru'
        ? `К заказу от ${baht(reward.minCheck, lang)}`
        : `With an order of ${baht(reward.minCheck, lang)} or more`
    case 'PERCENT_OFF':
      if (reward.maxDiscount === null) {
        return null
      }
      return lang === 'ru'
        ? `Скидка не больше ${baht(reward.maxDiscount, lang)}`
        : `Up to ${baht(reward.maxDiscount, lang)} off`
    case 'FIXED_POINTS':
    case 'GIFT_STAMPS':
      return null
  }
}

const steps = (reward: PartnershipReward, fromVenue: string | null, lang: Lang): string[] => {
  const limit = condition(reward, lang)

  return [
    lang === 'ru' ? 'Покажите код на кассе' : 'Show the code at the till',
    ...(limit === null ? [] : [limit]),
    ...(fromVenue === null
      ? []
      : [
          lang === 'ru'
            ? `Подарок от партнёра — ${fromVenue}`
            : `A gift from our partner ${fromVenue}`,
        ]),
  ]
}

/**
 * @param fromVenue заведение, у которого гость заработал подарок. null — имя
 *   недоступно; строка «от партнёра» тогда просто не появится.
 */
export const partnerOfferTexts = (
  reward: PartnershipReward,
  fromVenue: string | null,
): OfferI18n => ({
  title: { ru: title(reward, 'ru'), en: title(reward, 'en') },
  howTo: { ru: steps(reward, fromVenue, 'ru'), en: steps(reward, fromVenue, 'en') },
})
