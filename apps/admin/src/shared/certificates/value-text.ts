import type { GiftValue } from '@positive/contracts'

import { fill } from '../format/fill'
import { formatBaht } from '../format/format'
import type { TranslationKey } from '../i18n'

/**
 * Что даёт сертификат — одной фразой: «скидка 500,00 ฿», «скидка 10%, не больше 300 ฿»,
 * «в подарок: десерт». Суммы приходят в сатангах, показываются в батах.
 */
export const certificateValueText = (
  value: GiftValue,
  t: (key: TranslationKey) => string,
): string => {
  switch (value.kind) {
    case 'FIXED_OFF':
      return fill(t('certificates.value.FIXED_OFF'), { amount: formatBaht(value.amount) })
    case 'PERCENT_OFF':
      return value.maxDiscount === null
        ? fill(t('certificates.value.PERCENT_OFF'), { percent: value.percent })
        : fill(t('certificates.value.PERCENT_OFF_MAX'), {
            percent: value.percent,
            max: formatBaht(value.maxDiscount),
          })
    case 'FREE_ITEM':
      return fill(t('certificates.value.FREE_ITEM'), { item: value.itemName })
  }
}
