import { useT } from '../../shared/i18n/i18n-context'
import { ThemeToggle } from '../../shared/theme/theme-toggle'
import { CardEmpty } from './components/card-empty'
import { CardError } from './components/card-error'
import { CardLoading } from './components/card-loading'
import { useCard } from './hooks'
import './card.css'

export function Page() {
  const t = useT()
  const card = useCard()

  return (
    <main className="card-page">
      <header className="card-page__header">
        <div>
          <h1 className="card-page__title">{t('card.title')}</h1>
          <p className="card-page__subtitle">{t('card.subtitle')}</p>
        </div>
        <ThemeToggle />
      </header>

      {card.isPending ? (
        <CardLoading />
      ) : card.isError ? (
        <CardError
          onRetry={() => {
            void card.refetch()
          }}
        />
      ) : (
        // Ветка «на карте есть баллы» приедет вместе с GET /v1/guest/card:
        // пока карта всегда пустая, и это настоящее состояние, а не заглушка.
        <CardEmpty />
      )}
    </main>
  )
}
