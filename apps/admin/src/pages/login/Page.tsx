import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { ApiError } from '../../shared/api/http'
import { useAuth } from '../../shared/auth/auth-context'
import { useT } from '../../shared/i18n'
import { ThemeToggle } from '../../shared/ui/theme-toggle'

/**
 * Вход в бэк-офис: код устройства + PIN (docs/02, раздел 1.3).
 *
 * Поля «устройство» на настоящем планшете не будет — код зашивается при
 * регистрации устройства владельцем. Веб-версия бэк-офиса работает с любого
 * браузера, поэтому здесь код вводится руками; демо-коды печатает pnpm db:seed.
 */
export function LoginPage(): ReactElement {
  const t = useT()
  const auth = useAuth()
  const navigate = useNavigate()

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

    void auth
      .login(deviceId.trim(), pin.trim())
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

  return (
    <div className="login">
      <div className="login__theme">
        <ThemeToggle />
      </div>

      <form className="login__card" onSubmit={onSubmit}>
        <span className="app-header__mark" aria-hidden="true" />
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="login__hint">{t('login.hint')}</p>

        <label className="login__field">
          <span className="login__label">{t('login.device')}</span>
          <input
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
        </label>

        <label className="login__field">
          <span className="login__label">{t('login.pin')}</span>
          <input
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
        </label>

        {error !== null ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="button button--primary login__submit" type="submit" disabled={pending}>
          {pending ? t('login.pending') : t('login.submit')}
        </button>
      </form>
    </div>
  )
}
