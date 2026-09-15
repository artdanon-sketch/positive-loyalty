import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { POINTS_ADJUST_MAX } from '@positive/contracts'

import { bahtToMinor } from '../../../shared/format/baht-input'
import { fill } from '../../../shared/format/fill'
import { formatBaht, formatSignedBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useAdjustPoints } from '../card-hooks'

/**
 * «Баллы вручную» в карточке гостя — только у владельца.
 * docs/02, раздел 5.2.3 · docs/11, У5.
 *
 * НАЧИСЛИТЬ ИЛИ СПИСАТЬ — ПЕРЕКЛЮЧАТЕЛЕМ, А НЕ МИНУСОМ В ПОЛЕ. Минус в сумме легко
 * не заметить, а выбранное «Списать» — нет. Сумма в батах, на сервер уходит
 * в сатангах (железное правило 4). Причина обязательна: она в истории действий.
 *
 * ОДИН КЛЮЧ ПОВТОРА НА ОДНО НАМЕРЕНИЕ, как у подарка: связь оборвалась, нажали
 * ещё раз — уйдёт тот же ключ, и баланс не поправится дважды. После успеха —
 * новый ключ.
 */

const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`

type Direction = 'EARN' | 'SPEND'

export function GuestPointsForm({ guestId }: { guestId: string }): ReactElement {
  const t = useT()
  const adjust = useAdjustPoints(guestId)

  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>('EARN')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [key, setKey] = useState(newKey)

  const minor = bahtToMinor(amount)
  const amountOk = minor !== null && minor <= POINTS_ADJUST_MAX
  const ready = amountOk && reason.trim().length >= 8

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || minor === null || adjust.isPending) {
      return
    }

    adjust.mutate(
      {
        key,
        input: { amount: direction === 'SPEND' ? -minor : minor, reason: reason.trim() },
      },
      {
        onSuccess: () => {
          setKey(newKey())
          setAmount('')
          setReason('')
          setDirection('EARN')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <section className="gift" aria-label={t('pointsForm.title')}>
        {adjust.isSuccess ? (
          <p className="gift__done" role="status">
            {fill(t('pointsForm.done'), {
              amount: formatSignedBaht(adjust.data.amount),
              balance: formatBaht(adjust.data.balance),
            })}
          </p>
        ) : null}
        <button
          className="button gift__open"
          type="button"
          onClick={() => {
            adjust.reset()
            setOpen(true)
          }}
        >
          {t('pointsForm.open')}
        </button>
      </section>
    )
  }

  return (
    <form className="gift__form" aria-labelledby="points-form-title" onSubmit={submit}>
      <h3 className="guest-card__section" id="points-form-title">
        {t('pointsForm.title')}
      </h3>

      <fieldset className="term-form__group">
        <legend className="field__label">{t('pointsForm.direction')}</legend>
        <div className="choice">
          {(['EARN', 'SPEND'] as const).map((option) => (
            <button
              key={option}
              className={
                direction === option ? 'choice__option choice__option--on' : 'choice__option'
              }
              type="button"
              aria-pressed={direction === option}
              onClick={() => {
                setDirection(option)
              }}
            >
              {t(option === 'EARN' ? 'pointsForm.earn' : 'pointsForm.spend')}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor="points-form-amount">
          {t('pointsForm.amount')}
        </label>
        <input
          id="points-form-amount"
          className="field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={amount.trim() !== '' && !amountOk}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
          }}
        />
        {amount.trim() !== '' && !amountOk ? (
          <span className="field__hint field__hint--error">{t('pointsForm.amountInvalid')}</span>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="points-form-reason">
          {t('pointsForm.reason')}
        </label>
        <input
          id="points-form-reason"
          className="field__input"
          type="text"
          maxLength={300}
          autoComplete="off"
          aria-describedby="points-form-reason-hint"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <span className="field__hint" id="points-form-reason-hint">
          {t('pointsForm.reasonHint')}
        </span>
      </div>

      {adjust.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {adjust.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          onClick={() => {
            setOpen(false)
          }}
        >
          {t('pointsForm.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={!ready || adjust.isPending}
        >
          {adjust.isPending
            ? t('common.saving')
            : t(direction === 'SPEND' ? 'pointsForm.submitSpend' : 'pointsForm.submitEarn')}
        </button>
      </div>
    </form>
  )
}
