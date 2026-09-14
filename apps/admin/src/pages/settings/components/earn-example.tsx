import type { ReactElement } from 'react'

import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Пример на чеке в 1 000 ฿: что получит гость и сколько сможет оплатить баллами.
 *
 * ЗАЧЕМ ПРИМЕР, А НЕ ПРОЦЕНТЫ. «5% начисления» и «20% оплаты» владелец кафе
 * понимает как два числа. «Гость платит 1 000 ฿ и получает 50 ฿ баллами»
 * он понимает как деньги. Решение о деньгах принимают, глядя на деньги.
 *
 * ФОРМУЛЫ ТЕ ЖЕ, ЧТО У КАССЫ (pos.service): округление вниз до сатанга.
 * Пример, который считает иначе, чем касса, хуже отсутствия примера —
 * владелец поверит экрану, а гость получит другое.
 *
 * Оплата баллами показана с оговоркой «если столько накопил»: потолок —
 * это доля чека, но не больше баланса гостя.
 */

/** Чек примера: 1 000 ฿ в сатангах. */
const RECEIPT = 100_000

export function EarnExample({
  earnRate,
  redeemRate,
}: {
  earnRate: number
  redeemRate: number
}): ReactElement {
  const t = useT()

  const earned = Math.floor((RECEIPT * earnRate) / 100)
  const redeemable = Math.floor((RECEIPT * redeemRate) / 100)

  return (
    <div className="example" aria-live="polite">
      <p className="example__title">{t('settings.example.title')}</p>
      <dl className="example__grid">
        <div>
          <dt>{t('settings.example.receipt')}</dt>
          <dd>{formatBaht(RECEIPT)}</dd>
        </div>
        <div>
          <dt>{t('settings.example.earn')}</dt>
          <dd className="example__accent">{formatBaht(earned)}</dd>
        </div>
        <div>
          <dt>{t('settings.example.redeem')}</dt>
          <dd>
            {formatBaht(redeemable)}
            <span className="example__note">{t('settings.example.redeemNote')}</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}
