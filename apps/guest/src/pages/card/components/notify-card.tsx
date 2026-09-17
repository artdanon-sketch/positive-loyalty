import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'
import { usePush } from '../../../shared/push/use-push'

/**
 * «Включить уведомления» на карте гостя. docs/02, раздел 2.10.
 *
 * ЧЕСТНОЕ ОБЕЩАНИЕ ВМЕСТО «БУДЬТЕ В КУРСЕ». Гость даёт разрешение один раз
 * и навсегда, поэтому он должен понимать, что именно придёт: сообщения
 * заведения — подарок ко дню рождения, новая акция, — а не «новости сервиса».
 *
 * ЗАПРЕТ ПОКАЗЫВАЕМ СЛОВАМИ, А НЕ КНОПКОЙ. После «запретить» браузер второй раз
 * не спросит, и кнопка «включить» молча ничего не сделает. Вернуть разрешение
 * можно только в настройках браузера — так и пишем.
 */
export function NotifyCard(): ReactElement | null {
  const t = useT()
  const push = usePush()

  if (push.state.kind === 'hidden') {
    return null
  }

  return (
    <section className="install" aria-labelledby="notify-title">
      <h2 className="card__sectionTitle" id="notify-title">
        {t('notify.title')}
      </h2>

      {push.state.kind === 'blocked' ? (
        <p className="install__hint">{t('notify.blocked')}</p>
      ) : push.state.kind === 'on' ? (
        <>
          <p className="install__hint">{t('notify.on')}</p>
          <button
            className="install__button install__button--ghost"
            disabled={push.busy}
            type="button"
            onClick={push.disable}
          >
            {t('notify.off')}
          </button>
        </>
      ) : (
        <>
          <p className="install__hint">{t('notify.hint')}</p>
          <button
            className="install__button"
            disabled={push.busy}
            type="button"
            onClick={push.enable}
          >
            {t('notify.enable')}
          </button>
        </>
      )}

      {push.error !== null ? (
        <p className="install__hint install__hint--error" role="alert">
          {push.error}
        </p>
      ) : null}
    </section>
  )
}
