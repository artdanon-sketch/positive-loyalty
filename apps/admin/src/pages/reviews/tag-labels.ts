import type { ReviewTag } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/** Быстрые отзывы по темам — подписи для сводки и карточки. docs/11, У10. */
export const TAG_LABELS: Readonly<Record<ReviewTag, TranslationKey>> = {
  QUALITY: 'reviews.tag.QUALITY',
  PRICE: 'reviews.tag.PRICE',
  ASSORTMENT: 'reviews.tag.ASSORTMENT',
  SERVICE: 'reviews.tag.SERVICE',
  STAFF: 'reviews.tag.STAFF',
}
