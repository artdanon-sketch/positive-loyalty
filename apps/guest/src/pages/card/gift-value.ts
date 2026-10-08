import type { GiftValue } from '@positive/contracts'

import { formatBaht } from '../../shared/format/baht'
import type { TranslationKey } from '../../shared/i18n/dictionaries'

/**
 * Что гость получит по сертификату — словами. docs/02, раздел 5.11.
 *
 * Название шаблона пишет владелец, и «Осенний сертификат» не говорит, скидка
 * это или чашка кофе. Без этой строки гость нажимал бы «Забрать», не зная что,
 * и узнавал бы ценность только на кассе. Сервер присылает её отдельным полем —
 * здесь она становится фразой на языке гостя.
 */
export const giftValueText = (value: GiftValue, t: (key: TranslationKey) => string): string => {
  switch (value.kind) {
    case 'FREE_ITEM':
      return t('promo.value.item').replace('{item}', value.itemName)
    case 'FIXED_OFF':
      return t('promo.value.fixed').replace('{amount}', formatBaht(value.amount))
    case 'PERCENT_OFF':
      return value.maxDiscount === null
        ? t('promo.value.percent').replace('{percent}', String(value.percent))
        : t('promo.value.percentCapped')
            .replace('{percent}', String(value.percent))
            .replace('{max}', formatBaht(value.maxDiscount))
  }
}
