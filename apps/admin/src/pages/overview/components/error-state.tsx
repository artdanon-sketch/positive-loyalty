import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'

interface ErrorStateProps {
  /** Повторная загрузка сводки. */
  readonly onRetry: () => void
}

/**
 * Ошибка загрузки: скелетоны заменяются карточкой с кнопкой «Повторить»,
 * остальной интерфейс остаётся живым (docs/03_Бэк-офис_экраны.md, раздел 2).
 * Текст говорит, что делать дальше, а не показывает код ответа.
 */
export function ErrorState({ onRetry }: ErrorStateProps): ReactElement {
  const t = useT()

  return (
    <div className="state state--error" role="alert">
      <span className="state__badge state__badge--error" aria-hidden="true">
        !
      </span>
      <h2 className="state__title">{t('overview.error.title')}</h2>
      <p className="state__hint">{t('overview.error.hint')}</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        {t('overview.error.retry')}
      </button>
    </div>
  )
}
