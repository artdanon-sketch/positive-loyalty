import { useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n/i18n-context'
import { NativeGoogleError, signInWithNativeGoogle } from '../../shared/native/google-sign-in'
import type { NativeGoogleFailure } from '../../shared/native/google-sign-in'

/**
 * «Войти через Google» в приложении на телефоне — родное окно выбора аккаунта
 * Android вместо веб-кнопки (та в приложении получала origin_mismatch).
 *
 * Кнопку рисуем сами: скрипт Google в вебвью не работает. Оформление — по
 * правилам Google для своих кнопок: белая плашка, цветная «G», «Войти через
 * Google». Форма и высота — как у Telegram рядом.
 */

interface Props {
  readonly clientId: string
  readonly onToken: (idToken: string) => void
  readonly disabled: boolean
}

const MESSAGE = {
  'no-account': 'signin.google.noAccount',
  failed: 'signin.google.failed',
} as const satisfies Record<Exclude<NativeGoogleFailure, 'canceled'>, string>

export function NativeGoogleButton({ clientId, onToken, disabled }: Props): ReactElement {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Exclude<NativeGoogleFailure, 'canceled'> | null>(null)

  const begin = (): void => {
    setBusy(true)
    setFailure(null)
    signInWithNativeGoogle(clientId)
      .then(onToken)
      .catch((cause: unknown) => {
        const reason = cause instanceof NativeGoogleError ? cause.reason : 'failed'
        if (reason !== 'canceled') {
          setFailure(reason)
        }
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <>
      <button className="signin__googleNative" type="button" onClick={begin} disabled={disabled || busy}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {t('signin.google.button')}
      </button>

      {failure !== null ? (
        <p className="signin__hint" role="alert">
          {t(MESSAGE[failure])}
        </p>
      ) : null}
    </>
  )
}
