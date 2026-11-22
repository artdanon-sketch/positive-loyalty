import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Navigate } from 'react-router-dom'

import { ApiError } from '../../shared/api/api-client'
import { ServerSetting } from '../../shared/config/server-setting'
import { useT } from '../../shared/i18n/i18n-context'
import { useSession } from '../../shared/session/session-context'
import { LookControls } from '../../shared/theme/theme-toggle'

import { SocialSection } from './SocialSection'

/**
 * Вход гостя: телефон → код. docs/02, разделы 1.1–1.2.
 *
 * Два шага на одном экране, без перехода: переход между страницами посреди
 * ввода кода теряет контекст, а гость стоит у кассы. Возврат к телефону —
 * ссылкой, чтобы исправить опечатку не начиная сначала.
 *
 * Пока нет SMS-провайдера, сервер возвращает код в ответе (только вне
 * production) — показываем его подсказкой. Появится провайдер — подсказка
 * исчезнет сама: поля в ответе не будет.
 */
export function Page(): ReactElement {
  const t = useT()
  const session = useSession()

  const [phone, setPhone] = useState('+66')
  const [code, setCode] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverOpen, setServerOpen] = useState(false)
  const pressTimer = useRef<number | null>(null)

  if (session.session !== null) {
    return <Navigate to="/" replace />
  }

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? cause.message : t('signin.error.network')

  const onRequest = (event: FormEvent): void => {
    event.preventDefault()
    setPending(true)
    setError(null)

    void session
      .requestCode(phone.trim())
      .then((result) => {
        setRequestId(result.requestId)
        setDevCode(result.devCode ?? null)
      })
      .catch((cause: unknown) => {
        setError(describe(cause))
      })
      .finally(() => {
        setPending(false)
      })
  }

  const onGoogle = (idToken: string): void => {
    setPending(true)
    setError(null)

    void session.signInWithGoogle(idToken).catch((cause: unknown) => {
      setError(describe(cause))
      setPending(false)
    })
  }

  const onVerify = (event: FormEvent): void => {
    event.preventDefault()
    if (requestId === null) {
      return
    }

    setPending(true)
    setError(null)

    void session.verifyCode(requestId, code.trim()).catch((cause: unknown) => {
      setError(describe(cause))
      setPending(false)
    })
  }

  // «Адрес сервера» — только после долгого нажатия на карту (22.11.2026):
  // гостю поле не нужно, а нам на ноутбуке и стенде — да. См. ServerSetting.
  const startPress = (): void => {
    pressTimer.current = window.setTimeout(() => {
      setServerOpen(true)
    }, 1500)
  }
  const endPress = (): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  return (
    <div className="signin">
      <div className="signin__top">
        <LookControls />
      </div>

      {/*
        Карта, какой она станет после входа (вариант A, 22.11.2026): гость видит,
        ради чего вводит телефон. Баллов не выдумываем — на месте числа прочерк.
      */}
      <div
        className="signin__preview"
        aria-hidden="true"
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(event) => {
          event.preventDefault()
        }}
      >
        <span className="signin__previewLabel">{t('signin.cardLabel')}</span>
        <span className="signin__previewPoints">
          <small>{t('signin.cardPoints')}</small>฿ —
        </span>
        <span className="signin__previewCode">
          {Array.from({ length: 16 }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      </div>

      <form className="signin__card" onSubmit={requestId === null ? onRequest : onVerify}>
        <h1 className="signin__title">{t('signin.title')}</h1>

        {requestId === null ? (
          <>
            <p className="signin__hint">{t('signin.hint.phone')}</p>

            <label className="signin__field">
              <span className="signin__label">{t('signin.phone')}</span>
              <input
                className="signin__input"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value)
                }}
                required
                minLength={9}
              />
            </label>
          </>
        ) : (
          <>
            <p className="signin__hint">{t('signin.hint.code')}</p>

            <label className="signin__field">
              <span className="signin__label">{t('signin.code')}</span>
              <input
                className="signin__input signin__input--code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }}
                required
                minLength={6}
                maxLength={6}
              />
            </label>

            {devCode !== null ? (
              <p className="signin__dev">
                {t('signin.devCode')} <b>{devCode}</b>
              </p>
            ) : null}

            <button
              className="signin__back"
              type="button"
              onClick={() => {
                setRequestId(null)
                setCode('')
                setDevCode(null)
                setError(null)
              }}
            >
              {t('signin.changePhone')}
            </button>
          </>
        )}

        {error !== null ? (
          <p className="signin__error" role="alert">
            {error}
          </p>
        ) : null}

        {serverOpen ? <ServerSetting initiallyOpen /> : null}

        <button className="signin__submit" type="submit" disabled={pending}>
          {pending
            ? t('signin.pending')
            : requestId === null
              ? t('signin.getCode')
              : t('signin.submit')}
        </button>

        {requestId === null ? <SocialSection onGoogleToken={onGoogle} disabled={pending} /> : null}
      </form>
    </div>
  )
}
