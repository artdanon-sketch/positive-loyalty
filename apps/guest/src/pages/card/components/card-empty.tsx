import { useT } from '../../../shared/i18n/i18n-context'

export function CardEmpty() {
  const t = useT()

  return (
    <div className="card-state">
      <h2 className="card-state__title">{t('card.empty.title')}</h2>
      <p className="card-state__text">{t('card.empty.text')}</p>
    </div>
  )
}
