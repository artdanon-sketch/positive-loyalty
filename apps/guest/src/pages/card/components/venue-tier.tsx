import type { ReactElement } from 'react'
import type { WalletMembership } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/baht'
import { useT } from '../../../shared/i18n/i18n-context'

/**
 * Статус гостя в заведении и сколько осталось до следующего.
 * docs/02, раздел 2.1 · docs/11, У3.
 *
 * ПРОГРЕСС — СЛОВАМИ, А НЕ ПОЛОСКОЙ. Условия у статуса — «любое из»: оборот
 * или визиты. Полоска показала бы одно из двух и соврала бы про второе.
 *
 * Лестницы в заведении нет — нет и строки: пустой «статус» гостю ничего не говорит.
 */
export function VenueTier({ membership }: { membership: WalletMembership }): ReactElement | null {
  const t = useT()
  const { tier, nextTier } = membership

  if (tier === null && nextTier === null) {
    return null
  }

  const ways =
    nextTier === null
      ? []
      : [
          nextTier.spentLeft === null
            ? null
            : t('card.tier.spentLeft').replace('{amount}', formatBaht(nextTier.spentLeft)),
          nextTier.visitsLeft === null
            ? null
            : t('card.tier.visitsLeft').replace('{n}', String(nextTier.visitsLeft)),
        ].filter((way): way is string => way !== null)

  return (
    <span className="venue__tier">
      {tier === null ? null : <b className="venue__tierName">{tier.name}</b>}
      {nextTier === null || ways.length === 0 ? null : (
        <span className="venue__next">
          {t('card.tier.next')
            .replace('{name}', nextTier.name)
            .replace('{ways}', ways.join(` ${t('card.tier.or')} `))}
        </span>
      )}
    </span>
  )
}
