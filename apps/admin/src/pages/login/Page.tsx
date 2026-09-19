import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { ApiError } from '../../shared/api/http'
import { useAuth } from '../../shared/auth/auth-context'
import { ServerSetting } from '../../shared/config/server-setting'
import { useT } from '../../shared/i18n'
import { ThemeToggle } from '../../shared/ui/theme-toggle'

/**
 * Вход в бэк-офис. Два разных человека — два разных входа (docs/02, раздел 1.3):
 *
 *   • ВЛАДЕЛЕЦ И МЕНЕДЖЕР — с ноутбука или телефона, по почте и паролю. Привычно
 *     и восстановимо: почта — это личность, пароль — подтверждение.
 *   • КАССИР — за планшетом, по коду устройства и PIN. Код зашит в планшет один
 *     раз, кассир вводит только PIN; личного логина у стойки набирать некому.
 *
 * Раньше экран был один на всех и говорил на языке кассы. Владелец за ноутбуком
 * читал «код устройства» как загадку — поэтому по умолчанию открыт его вход,
 * а вход кассира спрятан за переключателем.
 */

type Mode = 'owner' | 'staff'

export function LoginPage(): ReactElement {
  const t = useT()
  const auth = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('owner')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [pin, setPin] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Живая сессия на /login — сразу в кабинет, а не второй вход поверх первого.
  if (auth.session !== null) {
    return <Navigate to="/" replace />
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setPending(true)
    setError(null)

    const attempt =
      mode === 'owner'
        ? auth.loginByEmail(email.trim(), password)
        : auth.login(deviceId.trim(), pin.trim())

    void attempt
      .then(() => {
        void navigate('/', { replace: true })
      })
      .catch((cause: unknown) => {
        // Сервер намеренно отвечает одинаково на все причины отказа —
        // показываем его текст, не выдумывая подробностей, которых нам не дали.
        setError(cause instanceof ApiError ? cause.message : t('login.error.network'))
      })
      .finally(() => {
        setPending(false)
      })
  }

  const switchMode = (next: Mode): void => {
    setMode(next)
    setError(null)
  }

  return (
    <div className="login">
      <div className="login__theme">
        <ThemeToggle />
      </div>

      <form className="login__card" onSubmit={onSubmit}>
        <span className="app-header__mark" aria-hidden="true" />
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="login__hint">{t('login.hint')}</p>

        <div className="login__tabs" role="tablist" aria-label={t('login.tabs.label')}>
          <button
            className={mode === 'owner' ? 'login__tab login__tab--on' : 'login__tab'}
            type="button"
            role="tab"
            aria-selected={mode === 'owner'}
            onClick={() => {
              switchMode('owner')
            }}
          >
            {t('login.tab.owner')}
          </button>
          <button
            className={mode === 'staff' ? 'login__tab login__tab--on' : 'login__tab'}
            type="button"
            role="tab"
            aria-selected={mode === 'staff'}
            onClick={() => {
              switchMode('staff')
            }}
          >
            {t('login.tab.staff')}
          </button>
        </div>

        {mode === 'owner' ? (
          <>
            <div className="login__field">
              <label className="login__label" htmlFor="login-email">
                {t('login.email')}
              </label>
              <input
                id="login-email"
                className="login__input"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                }}
                required
              />
              <span className="login__fieldHint">{t('login.email.hint')}</span>
            </div>

            <div className="login__field">
              <label className="login__label" htmlFor="login-password">
                {t('login.password')}
              </label>
              <input
                id="login-password"
                className="login__input"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                }}
                required
                minLength={8}
              />
              <span className="login__fieldHint">{t('login.password.hint')}</span>
            </div>
          </>
        ) : (
          <>
            <div className="login__field">
              <label className="login__label" htmlFor="login-device">
                {t('login.device')}
              </label>
              <input
                id="login-device"
                className="login__input"
                name="device"
                autoComplete="username"
                value={deviceId}
                onChange={(event) => {
                  setDeviceId(event.target.value)
                }}
                required
                minLength={8}
              />
              <span className="login__fieldHint">{t('login.device.hint')}</span>
            </div>

            <div className="login__field">
              <label className="login__label" htmlFor="login-pin">
                {t('login.pin')}
              </label>
              <input
                id="login-pin"
                className="login__input"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value)
                }}
                required
                minLength={4}
                maxLength={32}
              />
              <span className="login__fieldHint">{t('login.pin.hint')}</span>
            </div>
          </>
        )}

        {error !== null ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button button--primary login__submit" type="submit" disabled={pending}>
          {pending ? t('login.pending') : t('login.submit')}
        </button>

        {/* Адрес сервера — только в приложении на телефоне. Место выбрано
            намеренно: именно здесь человек оказывается, когда вход не идёт,
            и именно отсюда он должен дотянуться до настройки сети. */}
        <ServerSetting />
      </form>
    </div>
  )
}
