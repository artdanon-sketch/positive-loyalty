import type { ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { OfferListFilter } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { OfferCard } from './components/offer-card'
import { useOffers } from './hooks'

/**
 * Экран «Акции». docs/03, раздел 4 · docs/10, раздел 5.3 · docs/11, У2.
 *
 * Список и дорога в конструктор. «Собрать акцию» — у владельца: собирать
 * и менять акции — его галочка в матрице прав (docs/05). Менеджер видит
 * те же карточки без кнопок; запрет всё равно стоит на сервере.
 *
 * Фильтр живёт в адресе (`?filter=LIVE`): ссылку «что у нас сейчас идёт» можно
 * переслать, а «Назад» из партнёрства возвращает туда же.
 */

const FILTERS: ReadonlyArray<{ value: OfferListFilter; label: TranslationKey }> = [
  { value: 'ALL', label: 'offers.filter.ALL' },
  { value: 'LIVE', label: 'offers.filter.LIVE' },
  { value: 'SCHEDULED', label: 'offers.filter.SCHEDULED' },
  { value: 'ENDED', label: 'offers.filter.ENDED' },
]

const toFilter = (value: string | null): OfferListFilter =>
  value === 'LIVE' || value === 'SCHEDULED' || value === 'ENDED' ? value : 'ALL'

export function OffersPage(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const [params, setParams] = useSearchParams()
  const filter = toFilter(params.get('filter'))
  const offers = useOffers(filter)

  return (
    <section className="page">
      <header className="page__head page__head--row">
        <div className="page__head">
          <h1 className="page__title">{t('offers.title')}</h1>
          <p className="page__subtitle">{t('offers.subtitle')}</p>
        </div>
        {isOwner ? (
          <Link className="button button--primary" to="/offers/new">
            {t('offers.create')}
          </Link>
        ) : null}
      </header>

      <div className="filter-chips" role="group" aria-label={t('offers.filter.label')}>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            className={
              filter === option.value
                ? 'chip chip--good filter-chip'
                : 'chip chip--neutral filter-chip'
            }
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => {
              setParams(option.value === 'ALL' ? {} : { filter: option.value }, { replace: true })
            }}
          >
            {t(option.label)}
          </button>
        ))}
      </div>

      {offers.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : offers.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{offers.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void offers.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : offers.data.items.length === 0 ? (
        <div className="state">
          <p className="state__title">
            {t(filter === 'ALL' ? 'offers.empty.title' : 'offers.empty.filtered')}
          </p>
          <p className="state__hint">{t('offers.empty.hint')}</p>
          <Link className={isOwner ? 'button' : 'button button--primary'} to="/partners">
            {t('offers.empty.action')}
          </Link>
        </div>
      ) : (
        <div className="offer-grid">
          {offers.data.items.map((offer) => (
            <OfferCard key={offer.id} offer={offer} />
          ))}
        </div>
      )}
    </section>
  )
}
