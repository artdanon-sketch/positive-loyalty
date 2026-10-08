import type { ReactElement } from 'react'
import type { WalletMembership } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/baht'
import { useT } from '../../../shared/i18n/i18n-context'

/**
 * «Баллы сгорят такого-то числа» на карточке заведения. docs/02, раздел 2.1.
 *
 * ЗАРАНЕЕ, А НЕ ПОСТФАКТУМ. Сгоревшие молча баллы — это не экономия заведения,
 * а обиженный человек у стойки: он копил и не знал, что у накоплений есть срок.
 *
 * ТОЛЬКО БЛИЖАЙШАЯ ПАРТИЯ И ТОЛЬКО КОГДА ЕСТЬ ЧТО ТЕРЯТЬ. Заведений без срока
 * жизни баллов большинство, и постоянная строка «ничего не сгорит» на карте
 * только шумит.
 */
export function ExpiryNote({ membership }: { membership: WalletMembership }): ReactElement | null {
  const t = useT()

  if (membership.expiring === null) {
    return null
  }

  return (
    <span className="venue__expiry">
      {t('card.venues.expiring')
        .replace('{points}', formatBaht(membership.expiring.points))
        .replace('{date}', new Date(membership.expiring.at).toLocaleDateString())}
    </span>
  )
}
