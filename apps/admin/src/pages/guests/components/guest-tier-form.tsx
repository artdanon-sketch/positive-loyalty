import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { AdminGuestCard } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { useTierSettings } from '../../settings/hooks'
import { useSetGuestTier } from '../tier-hooks'

/**
 * «Изменить статус» в карточке гостя. docs/02, раздел 5.2.2 · docs/11, У3.
 *
 * Только у владельца: статус меняет ставки, то есть деньги. Первый пункт —
 * «по лестнице»: вернуть гостя к автоматическому расчёту. Причина обязательна —
 * через месяц владелец должен видеть, почему у гостя «Друзья».
 *
 * Лестницы нет — нет и кнопки: назначать нечего.
 */
export function GuestTierForm({
  guestId,
  current,
}: {
  guestId: string
  current: AdminGuestCard['tier']
}): ReactElement | null {
  const t = useT()
  const ladder = useTierSettings()
  const setTier = useSetGuestTier(guestId)

  const [open, setOpen] = useState(false)
  const [tierId, setTierId] = useState(current !== null && current.manual ? current.id : '')
  const [reason, setReason] = useState('')

  if (!ladder.isSuccess || ladder.data.tiers.length === 0) {
    return null
  }

  const ready = reason.trim().length >= 8

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || setTier.isPending) {
      return
    }

    setTier.mutate(
      { tierId: tierId === '' ? null : tierId, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <section className="gift" aria-label={t('tierForm.title')}>
        {setTier.isSuccess ? (
          <p className="gift__done" role="status">
            {fill(t(setTier.data.manual ? 'tierForm.done' : 'tierForm.doneLadder'), {
              name: setTier.data.name ?? t('tierForm.noTier'),
            })}
          </p>
        ) : null}
        <button
          className="button gift__open"
          type="button"
          onClick={() => {
            setTier.reset()
            setOpen(true)
          }}
        >
          {t('tierForm.open')}
        </button>
      </section>
    )
  }

  return (
    <form className="gift__form" aria-labelledby="tier-form-title" onSubmit={submit}>
      <h3 className="guest-card__section" id="tier-form-title">
        {t('tierForm.title')}
      </h3>

      <div className="field">
        <label className="field__label" htmlFor="tier-form-tier">
          {t('tierForm.tier')}
        </label>
        <select
          id="tier-form-tier"
          className="field__input"
          value={tierId}
          onChange={(event) => {
            setTierId(event.target.value)
          }}
        >
          <option value="">{t('tierForm.ladder')}</option>
          {ladder.data.tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.hidden ? fill(t('tierForm.hiddenOption'), { name: tier.name }) : tier.name}
            </option>
          ))}
        </select>
        <span className="field__hint">{t('tierForm.hint')}</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="tier-form-reason">
          {t('tierForm.reason')}
        </label>
        <input
          id="tier-form-reason"
          className="field__input"
          type="text"
          maxLength={300}
          autoComplete="off"
          aria-describedby="tier-form-reason-hint"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <span className="field__hint" id="tier-form-reason-hint">
          {t('tierForm.reasonHint')}
        </span>
      </div>

      {setTier.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {setTier.error.message}
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
          {t('tierForm.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={!ready || setTier.isPending}
        >
          {setTier.isPending ? t('common.saving') : t('tierForm.submit')}
        </button>
      </div>
    </form>
  )
}
