import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'

/**
 * Ошибка загрузки карты. Показываем текст сервера: он написан для человека
 * и уже локализован. Своё «что-то пошло не так» скрыло бы причину, которую
 * сервер потрудился объяснить.
 */
export function CardError({
  message,
  onRetry,
}: {
  message?: string
  onRetry: () => void
}): ReactElement {
  const t = useT()

  return (
    <section className="card__state card__state--error" role="alert">
      <h2 className="card__stateTitle">{t('card.error.title')}</h2>
      <p className="card__stateHint">{message ?? t('card.error.hint')}</p>
      <button className="card__retry" type="button" onClick={onRetry}>
        {t('card.error.retry')}
      </button>
    </section>
  )
}
