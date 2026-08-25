import { useT } from '../../../shared/i18n/i18n-context'

export function CardLoading() {
  const t = useT()

  return (
    <div className="card-state" aria-busy="true" aria-live="polite">
      <p className="card-state__hint">{t('card.loading.label')}</p>
      <div className="card-skeleton" />
      <div className="card-skeleton card-skeleton--short" />
    </div>
  )
}
