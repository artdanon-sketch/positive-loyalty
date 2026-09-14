import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useT } from '../../shared/i18n'
import { PartnerCatalogView } from './components/partner-catalog'
import { PartnershipList } from './components/partnership-list'

/**
 * Раздел «Партнёры». docs/10, раздел 5.4 · docs/07, раздел 10.
 *
 * Две вкладки: свои партнёрства и каталог сети. Вкладка живёт в адресе
 * (`?tab=catalog`): ссылку «найди партнёра» можно переслать, а «Назад»
 * из карточки заведения возвращает туда, откуда пришли.
 *
 * Менеджер видит всё, но договариваться не может — кнопок у него нет,
 * а сервер ответил бы отказом (docs/02, раздел 5.8).
 */
export function PartnersPage(): ReactElement {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'catalog' ? 'catalog' : 'mine'

  const open = (next: 'mine' | 'catalog'): void => {
    setParams(next === 'catalog' ? { tab: 'catalog' } : {}, { replace: true })
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('partners.title')}</h1>
        <p className="page__subtitle">{t('partners.subtitle')}</p>
      </header>

      <div className="tabs" role="tablist" aria-label={t('partners.title')}>
        <button
          className={tab === 'mine' ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => {
            open('mine')
          }}
        >
          {t('partners.tab.mine')}
        </button>
        <button
          className={tab === 'catalog' ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
          type="button"
          role="tab"
          aria-selected={tab === 'catalog'}
          onClick={() => {
            open('catalog')
          }}
        >
          {t('partners.tab.catalog')}
        </button>
      </div>

      {tab === 'mine' ? (
        <PartnershipList
          onFind={() => {
            open('catalog')
          }}
        />
      ) : (
        <PartnerCatalogView />
      )}
    </section>
  )
}
