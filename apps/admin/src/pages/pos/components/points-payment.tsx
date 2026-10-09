import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PreviewResult } from '@positive/contracts'

import { bahtToMinor } from '../../../shared/format/baht-input'
import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Оплата баллами на кассе. docs/02, раздел 3.2.
 *
 * Главное, ради чего гость копит: часть чека — баллами. Сервер давно умел
 * (`redeemRequested`), а у кассира не было кнопки — гость с балансом уходил,
 * заплатив всё деньгами.
 *
 * ПОТОЛОК СЧИТАЕТ СЕРВЕР. Здесь он только показан: доля чека из настроек, но не
 * больше баланса (`maxRedeemable`). Попросят больше — сервер спишет потолок,
 * и кассир увидит, сколько списалось на самом деле, до проведения.
 *
 * НЕ МЕШАЕТ ДВУМ ТАПАМ. Без баллов чек проводится как раньше: блок — лишь
 * предложение, а не обязательный шаг. Поле сразу заполнено потолком — чаще всего
 * гость хочет списать сколько можно, и это одно нажатие.
 */
export function PointsPayment({
  preview,
  pending,
  onApply,
  onClear,
}: {
  preview: PreviewResult
  pending: boolean
  onApply: (minor: number) => void
  onClear: () => void
}): ReactElement | null {
  const t = useT()
  const [amount, setAmount] = useState(() => String(preview.maxRedeemable / 100))

  if (preview.redeem > 0) {
    return (
      <div className="pos__points">
        <p className="pos__points-text">
          {fill(t('pos.points.applied'), { amount: formatBaht(preview.redeem) })}
        </p>
        <button className="button button--ghost" type="button" disabled={pending} onClick={onClear}>
          {t('pos.points.clear')}
        </button>
      </div>
    )
  }

  if (preview.maxRedeemable <= 0) {
    return null
  }

  const minor = bahtToMinor(amount)

  return (
    <form
      className="pos__points"
      onSubmit={(event) => {
        event.preventDefault()

        if (minor !== null) {
          onApply(minor)
        }
      }}
    >
      <label className="field">
        <span className="field__label">
          {fill(t('pos.points.available'), { amount: formatBaht(preview.maxRedeemable) })}
        </span>
        <input
          className="field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={minor === null}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
          }}
        />
      </label>
      <button className="button" type="submit" disabled={pending || minor === null}>
        {pending ? t('common.loading') : t('pos.points.apply')}
      </button>
    </form>
  )
}
