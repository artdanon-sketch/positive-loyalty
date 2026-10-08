import type { ReactElement } from 'react'
import type { ProgramMode } from '@positive/contracts'

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
 *
 * В РЕЖИМЕ СКИДКИ пример показывает скидку и сумму к оплате, а потолок баллов —
 * от того, что осталось после скидки: ровно в этом порядке считает касса
 * (checkout-math.ts).
 */

/** Чек примера: 1 000 ฿ в сатангах. */
const RECEIPT = 100_000

export function EarnExample({
  mode,
  earnRate,
  redeemRate,
}: {
  mode: ProgramMode
  earnRate: number
  redeemRate: number
}): ReactElement {
  const t = useT()

  const reward = Math.floor((RECEIPT * earnRate) / 100)
  const due = mode === 'DISCOUNT' ? RECEIPT - reward : RECEIPT
  const redeemable = Math.floor((due * redeemRate) / 100)

  return (
    <div className="example" aria-live="polite">
      <p className="example__title">{t('settings.example.title')}</p>
      <dl className="example__grid">
        <div>
          <dt>{t('settings.example.receipt')}</dt>
          <dd>{formatBaht(RECEIPT)}</dd>
        </div>
        <div>
          <dt>{t(mode === 'DISCOUNT' ? 'settings.example.discount' : 'settings.example.earn')}</dt>
          <dd className="example__accent">{formatBaht(reward)}</dd>
        </div>
        {mode === 'DISCOUNT' ? (
          <div>
            <dt>{t('settings.example.toPay')}</dt>
            <dd>{formatBaht(due)}</dd>
          </div>
        ) : null}
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
