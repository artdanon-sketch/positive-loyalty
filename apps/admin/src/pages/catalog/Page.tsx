import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { CatalogItem } from '@positive/contracts'

import { formatBaht } from '../../shared/format/format'
import { useT } from '../../shared/i18n'
import { useCatalog, useCreateCatalogItem, useUpdateCatalogItem } from './hooks'
import { BLANK_ITEM, fromItemDraft, ITEM_PROBLEM } from './item-draft'
import type { ItemDraft } from './item-draft'

/**
 * Экран «Товары и услуги». docs/03, раздел 9.3.
 *
 * ЭТО ВИТРИНА, А НЕ СКЛАД. Остатки и поставщиков ведёт касса; здесь только то,
 * что видит гость, и цена в баллах — ради неё экран и существует.
 *
 * УДАЛЕНИЯ НЕТ, ЕСТЬ «СНЯТЬ С ВИТРИНЫ». Позиция, на которую гость когда-то
 * копил, не должна исчезать из списка владельца: иначе не разобрать ни спор,
 * ни старый заказ.
 */
export function CatalogPage(): ReactElement {
  const t = useT()
  const catalog = useCatalog()
  const create = useCreateCatalogItem()
  const update = useUpdateCatalogItem()

  const [draft, setDraft] = useState<ItemDraft>(BLANK_ITEM)
  const [touched, setTouched] = useState(false)

  const checked = fromItemDraft(draft, catalog.data?.length ?? 0)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setTouched(true)

    if (!checked.ok || create.isPending) {
      return
    }

    create.mutate(checked.input, {
      onSuccess: () => {
        setDraft(BLANK_ITEM)
        setTouched(false)
      },
    })
  }

  const priceOf = (item: CatalogItem): string => {
    const money = item.priceMinor === null ? null : formatBaht(item.priceMinor)
    const points = item.pointsPrice === null ? null : `${String(item.pointsPrice)} ★`

    return [money, points].filter((part) => part !== null).join(' · ')
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('catalog.title')}</h1>
        <p className="page__subtitle">{t('catalog.subtitle')}</p>
      </header>

      <form className="panel" aria-labelledby="catalog-form" onSubmit={submit}>
        <h2 className="panel__title" id="catalog-form">
          {t('catalog.add')}
        </h2>

        <div className="field">
          <label className="field__label" htmlFor="catalog-name">
            {t('catalog.field.name')}
          </label>
          <input
            className="field__input"
            id="catalog-name"
            maxLength={120}
            type="text"
            value={draft.name}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value })
            }}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="catalog-description">
            {t('catalog.field.description')}
          </label>
          <textarea
            className="field__input review-card__textarea"
            id="catalog-description"
            maxLength={500}
            rows={2}
            value={draft.description}
            onChange={(event) => {
              setDraft({ ...draft, description: event.target.value })
            }}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="catalog-price">
            {t('catalog.field.price')}
          </label>
          <input
            className="field__input"
            id="catalog-price"
            inputMode="decimal"
            type="text"
            value={draft.priceBaht}
            onChange={(event) => {
              setDraft({ ...draft, priceBaht: event.target.value })
            }}
          />
          <p className="field__hint">{t('catalog.field.priceHint')}</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="catalog-points">
            {t('catalog.field.points')}
          </label>
          <input
            className="field__input"
            id="catalog-points"
            inputMode="numeric"
            type="text"
            value={draft.points}
            onChange={(event) => {
              setDraft({ ...draft, points: event.target.value.replace(/\D/g, '') })
            }}
          />
          <p className="field__hint">{t('catalog.field.pointsHint')}</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="catalog-image">
            {t('catalog.field.image')}
          </label>
          <input
            className="field__input"
            id="catalog-image"
            maxLength={500}
            placeholder="https://"
            type="url"
            value={draft.imageUrl}
            onChange={(event) => {
              setDraft({ ...draft, imageUrl: event.target.value })
            }}
          />
        </div>

        <div className="save-bar">
          {touched && !checked.ok ? (
            <p className="state__hint state__hint--error" role="status">
              {t(ITEM_PROBLEM[checked.problem])}
            </p>
          ) : create.isError ? (
            <p className="state__hint state__hint--error" role="alert">
              {create.error.message}
            </p>
          ) : null}
          <button className="button button--primary" disabled={create.isPending} type="submit">
            {create.isPending ? t('common.saving') : t('catalog.create')}
          </button>
        </div>
      </form>

      <section className="panel" aria-labelledby="catalog-list">
        <h2 className="panel__title" id="catalog-list">
          {t('catalog.list')}
        </h2>

        {catalog.isPending ? (
          <p className="state__hint" role="status">
            {t('common.loading')}
          </p>
        ) : catalog.isError ? (
          <div role="alert">
            <p className="state__hint state__hint--error">{catalog.error.message}</p>
            <button
              className="button"
              type="button"
              onClick={() => {
                void catalog.refetch()
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : catalog.data.length === 0 ? (
          <p className="state__hint">{t('catalog.empty')}</p>
        ) : (
          <div className="review-list">
            {catalog.data.map((item) => (
              <article className="review-card" key={item.id}>
                <header className="review-card__head">
                  <h3 className="review-card__title">{item.name}</h3>
                  <span className={item.isActive ? 'chip chip--good' : 'chip chip--muted'}>
                    {t(item.isActive ? 'catalog.on' : 'catalog.off')}
                  </span>
                </header>
                {item.description === '' ? null : (
                  <p className="review-card__text">{item.description}</p>
                )}
                <p className="field__hint">{priceOf(item)}</p>
                <div className="panel__actions">
                  <button
                    className="button"
                    disabled={update.isPending}
                    type="button"
                    onClick={() => {
                      update.mutate({ id: item.id, input: { isActive: !item.isActive } })
                    }}
                  >
                    {t(item.isActive ? 'catalog.hide' : 'catalog.show')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
