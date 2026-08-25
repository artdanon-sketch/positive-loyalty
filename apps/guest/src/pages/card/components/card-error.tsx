import { useT } from '../../../shared/i18n/i18n-context'

interface CardErrorProps {
  onRetry: () => void
}

export function CardError({ onRetry }: CardErrorProps) {
  const t = useT()

  return (
    <div className="card-state" role="alert">
      <h2 className="card-state__title card-state__title--bad">{t('card.error.title')}</h2>
      <p className="card-state__text">{t('card.error.text')}</p>
      <button type="button" className="card-state__action" onClick={onRetry}>
        {t('card.error.retry')}
      </button>
    </div>
  )
}
