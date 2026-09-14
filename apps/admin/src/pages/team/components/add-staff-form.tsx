import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { CreateStaffResult, ManagedRole } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useAddStaff } from '../hooks'

/**
 * Добавление сотрудника: имя, роль, PIN, где стоит планшет.
 *
 * РОЛЬ ВЫБИРАЕТСЯ С ОБЪЯСНЕНИЕМ. «Кассир» и «менеджер» владелец кафе понимает
 * по-своему, а права за ними конкретные: менеджер может отменять чужие чеки.
 * Подпись под каждым вариантом говорит, что именно человек сможет, — до того,
 * как владелец узнает это из спорной отмены.
 *
 * ОТКАЗ СЕРВЕРА ПОКАЗЫВАЕТСЯ ЕГО СЛОВАМИ. «Слишком простой PIN: такие подбирают
 * первыми» написано для человека — переписывать его на клиенте значило бы
 * завести вторую, отстающую копию правил.
 */
export function AddStaffForm({
  onCreated,
  onCancel,
}: {
  onCreated: (result: CreateStaffResult, pin: string) => void
  onCancel: () => void
}): ReactElement {
  const t = useT()
  const add = useAddStaff()

  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<ManagedRole>('CASHIER')
  const [pin, setPin] = useState('')
  const [deviceLabel, setDeviceLabel] = useState('')

  const pinShapeOk = /^\d{4,6}$/.test(pin)
  const canSubmit = displayName.trim() !== '' && pinShapeOk && !add.isPending

  const submit = (event: FormEvent): void => {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    add.mutate(
      {
        displayName: displayName.trim(),
        role,
        pin,
        ...(deviceLabel.trim() === '' ? {} : { deviceLabel: deviceLabel.trim() }),
      },
      {
        onSuccess: (result) => {
          onCreated(result, pin)
        },
      },
    )
  }

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="add-staff-title">
      <h2 className="panel__title" id="add-staff-title">
        {t('team.form.title')}
      </h2>

      <div className="panel__grid">
        <label className="field">
          <span className="field__label">{t('team.form.name')}</span>
          <input
            className="field__input"
            type="text"
            maxLength={60}
            autoComplete="off"
            placeholder={t('team.form.namePlaceholder')}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
            }}
          />
        </label>

        <div className="field">
          {/* Подсказка — НЕ внутри label. Иначе её текст склеивается с подписью:
              экранный диктор читает «PIN для входаОт 4 до 6 цифр» одной фразой,
              а поле перестаёт находиться по своему имени. Подсказка привязана
              к полю через aria-describedby и зачитывается после имени. */}
          <label className="field__label" htmlFor="add-staff-pin">
            {t('team.form.pin')}
          </label>
          <input
            id="add-staff-pin"
            className="field__input field__input--mono"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            aria-describedby="add-staff-pin-hint"
            value={pin}
            onChange={(event) => {
              // Только цифры: буква в PIN на планшете кассы не набирается.
              setPin(event.target.value.replace(/\D/g, ''))
            }}
          />
          <span className="field__hint" id="add-staff-pin-hint">
            {t('team.form.pinHint')}
          </span>
        </div>
      </div>

      <fieldset className="choice">
        <legend className="field__label">{t('team.form.role')}</legend>
        {(['CASHIER', 'MANAGER'] as const).map((option) => (
          <label
            className={`choice__option${role === option ? ' choice__option--on' : ''}`}
            key={option}
          >
            <input
              type="radio"
              name="staff-role"
              value={option}
              checked={role === option}
              onChange={() => {
                setRole(option)
              }}
            />
            <span className="choice__text">
              <b>{t(option === 'CASHIER' ? 'role.cashier' : 'role.manager')}</b>
              <span>
                {t(option === 'CASHIER' ? 'team.role.cashier.hint' : 'team.role.manager.hint')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        <span className="field__label">{t('team.form.device')}</span>
        <input
          className="field__input"
          type="text"
          maxLength={60}
          autoComplete="off"
          placeholder={t('team.form.devicePlaceholder')}
          value={deviceLabel}
          onChange={(event) => {
            setDeviceLabel(event.target.value)
          }}
        />
      </label>

      {add.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {add.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="button button--ghost" type="button" onClick={onCancel}>
          {t('team.form.cancel')}
        </button>
        <button className="button button--primary" type="submit" disabled={!canSubmit}>
          {add.isPending ? t('common.saving') : t('team.form.submit')}
        </button>
      </div>
    </form>
  )
}
