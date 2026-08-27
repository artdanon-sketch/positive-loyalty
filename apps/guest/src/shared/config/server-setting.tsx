import { useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../i18n/i18n-context'
import { DEFAULT_API_URL, getApiUrl, setApiUrl } from './api-url'
import { isNativeApp } from './platform'

/**
 * Адрес сервера — настройка для приложения на телефоне.
 *
 * В ВЕБЕ ЭТОГО БЛОКА НЕТ, и это не экономия места. В браузере адрес API
 * известен из сборки и совпадает с тем, откуда открыта страница; поле для его
 * замены там — приглашение сломать себе вход. В приложении наоборот: без него
 * телефон не найдёт сервер вообще.
 *
 * Свёрнут по умолчанию: обычная смена начинается со входа, а не с настройки
 * сети. Разворачивается одним нажатием, когда вход не удался.
 */
export function ServerSetting(): ReactElement | null {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState(getApiUrl)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!isNativeApp()) {
    return null
  }

  return (
    <div className="server-setting">
      <button
        className="server-setting__toggle"
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((open) => !open)
        }}
      >
        {t('server.title')}
      </button>

      {isOpen ? (
        <form
          className="server-setting__form"
          onSubmit={(event) => {
            event.preventDefault()
            const ok = setApiUrl(value)
            setError(!ok)
            setSaved(ok)

            if (ok) {
              // Перезагрузка, а не тихое применение: часть состояния уже
              // прочитала прежний адрес, и половинчатое переключение
              // выглядело бы как случайные сбои сети.
              window.location.reload()
            }
          }}
        >
          <label className="field">
            <span className="field__label">{t('server.label')}</span>
            <input
              className="field__input"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={DEFAULT_API_URL}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError(false)
                setSaved(false)
              }}
            />
          </label>

          <p className="server-setting__hint">{t('server.hint')}</p>

          {error ? (
            <p className="server-setting__error" role="alert">
              {t('server.invalid')}
            </p>
          ) : null}
          {saved ? <p className="server-setting__hint">{t('server.saved')}</p> : null}

          <button className="button button--ghost" type="submit">
            {t('server.save')}
          </button>
        </form>
      ) : null}
    </div>
  )
}
