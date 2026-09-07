import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { env } from '../../shared/config/env'
import { fetchServerLogins } from '../../shared/api/server-logins'
import type { ServerLogins } from '../../shared/api/server-logins'
import { useT } from '../../shared/i18n/i18n-context'

import { GoogleButton } from './GoogleButton'
import { TelegramButton } from './TelegramButton'

/**
 * Блок «войти через аккаунт»: разделитель и все кнопки под ним.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ. Разделитель «или» должен появляться ровно тогда,
 * когда под ним есть хоть одна кнопка. Пока способ входа был один, условие
 * жило внутри самой кнопки — и это было правильно. Со вторым способом условие
 * стало общим, а общее условие обязано жить в одном месте: две копии
 * разъедутся ровно в тот момент, когда что-то пойдёт не так. Один раз это уже
 * случилось — на боевой странице висело «или», под которым не было ничего.
 *
 * ЧТО РЕШАЕТ, ПОКАЗЫВАТЬ ЛИ КНОПКУ. Спрашиваем сервер. Кнопка входа без
 * серверной половины бесполезна: сервер, у которого нет ключа, отвергнет
 * любую попытку. У Google условие двойное — ключ нужен и серверу (проверить
 * токен), и сборке страницы (нарисовать кнопку). Не хватает любой половины —
 * кнопки нет: показать заведомо нерабочую хуже, чем не показать.
 */

interface Props {
  /** Токен от Google. Проверяет его сервер, не мы. */
  readonly onGoogleToken: (idToken: string) => void
  readonly disabled: boolean
}

export function SocialSection({ onGoogleToken, disabled }: Props): ReactElement | null {
  const t = useT()
  const [logins, setLogins] = useState<ServerLogins | null>(null)

  useEffect(() => {
    let alive = true

    void fetchServerLogins().then((result) => {
      if (alive) {
        setLogins(result)
      }
    })

    return () => {
      alive = false
    }
  }, [])

  // Пока сервер не ответил, не показываем ничего. Мигнуть кнопкой и убрать её
  // хуже, чем показать на полсекунды позже: палец уже летит к экрану.
  if (logins === null) {
    return null
  }

  const google = logins.google && (env.VITE_GOOGLE_CLIENT_ID ?? '') !== ''
  const telegram = logins.telegram

  if (!google && !telegram) {
    return null
  }

  return (
    <>
      <div className="signin__divider">
        <span>{t('signin.or')}</span>
      </div>

      {google ? <GoogleButton onToken={onGoogleToken} disabled={disabled} /> : null}
      {telegram ? <TelegramButton disabled={disabled} /> : null}
    </>
  )
}
