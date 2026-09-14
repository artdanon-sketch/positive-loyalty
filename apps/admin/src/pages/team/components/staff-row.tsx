import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { StaffMember } from '@positive/contracts'

import { formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useResetStaffPin, useUpdateStaff } from '../hooks'

/**
 * Строка сотрудника с действиями.
 *
 * ОТКЛЮЧЕНИЕ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ, ВКЛЮЧЕНИЕ — НЕТ. Отключение выкидывает
 * человека из кассы сразу, посреди чека; случайный тап здесь стоит очереди
 * у стойки. Включение ничего не ломает — переспрашивать там незачем.
 *
 * Подтверждение — строкой в самой таблице, а не системным окном браузера:
 * `window.confirm` блокирует страницу, не переводится и выглядит как ошибка.
 *
 * У ВЛАДЕЛЬЦА ДЕЙСТВИЙ НЕТ. Сервер его строку и так не примет; показывать кнопки,
 * которые ответят отказом, — значит учить не доверять интерфейсу.
 */

const ROLE_KEYS: Readonly<Record<StaffMember['role'], TranslationKey>> = {
  OWNER: 'role.owner',
  MANAGER: 'role.manager',
  CASHIER: 'role.cashier',
}

export function StaffRow({ member }: { member: StaffMember }): ReactElement {
  const t = useT()
  const update = useUpdateStaff()
  const resetPin = useResetStaffPin()

  const [confirmingOff, setConfirmingOff] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')

  const device = member.devices.find((item) => item.isActive) ?? member.devices[0] ?? null
  const isOwner = member.role === 'OWNER'
  const busy = update.isPending || resetPin.isPending

  const status = !member.isActive
    ? { key: 'team.status.off' as const, tone: 'chip--muted' }
    : member.isLocked
      ? { key: 'team.status.locked' as const, tone: 'chip--bad' }
      : { key: 'team.status.active' as const, tone: 'chip--good' }

  const submitPin = (event: FormEvent): void => {
    event.preventDefault()

    if (!/^\d{4,6}$/.test(pin)) {
      return
    }

    resetPin.mutate(
      { id: member.id, pin },
      {
        onSuccess: () => {
          setPin('')
          setPinOpen(false)
        },
      },
    )
  }

  const error = update.error ?? resetPin.error

  return (
    <tr className={member.isActive ? undefined : 'data-table__row--muted'}>
      <td>
        <b>{member.displayName}</b>
        {device !== null ? <span className="data-table__sub">{device.label}</span> : null}
      </td>
      <td>
        <span className={`chip ${isOwner ? 'chip--neutral' : 'chip--muted'}`}>
          {t(ROLE_KEYS[member.role])}
        </span>
      </td>
      <td>
        <span className={`chip ${status.tone}`}>{t(status.key)}</span>
      </td>
      <td>
        {member.lastSeenAt === null ? t('team.lastSeen.never') : formatDateTime(member.lastSeenAt)}
      </td>
      <td className="data-table__mono">{device?.deviceCode ?? '—'}</td>
      <td>
        {isOwner ? (
          <span className="data-table__sub">{t('team.owner.noActions')}</span>
        ) : confirmingOff ? (
          <div className="row-actions" role="group" aria-label={t('team.action.disable')}>
            <span className="row-actions__warn">{t('team.action.disableConfirm')}</span>
            <button
              className="button button--danger"
              type="button"
              disabled={busy}
              onClick={() => {
                update.mutate(
                  { id: member.id, patch: { isActive: false } },
                  {
                    onSettled: () => {
                      setConfirmingOff(false)
                    },
                  },
                )
              }}
            >
              {t('team.action.disable')}
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setConfirmingOff(false)
              }}
            >
              {t('team.form.cancel')}
            </button>
          </div>
        ) : pinOpen ? (
          <form className="row-actions" onSubmit={submitPin}>
            <input
              className="field__input field__input--mono field__input--compact"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              aria-label={t('team.form.pin')}
              placeholder="••••"
              value={pin}
              onChange={(event) => {
                setPin(event.target.value.replace(/\D/g, ''))
              }}
            />
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || !/^\d{4,6}$/.test(pin)}
            >
              {t('team.action.pinSave')}
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setPinOpen(false)
                setPin('')
              }}
            >
              {t('team.form.cancel')}
            </button>
          </form>
        ) : (
          <div className="row-actions">
            {member.isActive ? (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPinOpen(true)
                  }}
                >
                  {t('team.action.pin')}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    update.mutate({
                      id: member.id,
                      patch: { role: member.role === 'CASHIER' ? 'MANAGER' : 'CASHIER' },
                    })
                  }}
                >
                  {t(
                    member.role === 'CASHIER'
                      ? 'team.action.makeManager'
                      : 'team.action.makeCashier',
                  )}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingOff(true)
                  }}
                >
                  {t('team.action.disable')}
                </button>
              </>
            ) : (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => {
                  update.mutate({ id: member.id, patch: { isActive: true } })
                }}
              >
                {t('team.action.enable')}
              </button>
            )}
            {resetPin.isSuccess ? (
              <span className="row-actions__ok" role="status">
                {t('team.action.pinDone')}
              </span>
            ) : null}
          </div>
        )}
        {error !== null ? (
          <p className="state__hint state__hint--error" role="alert">
            {error.message}
          </p>
        ) : null}
      </td>
    </tr>
  )
}
