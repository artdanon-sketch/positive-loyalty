import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { SaleKind } from '@positive/contracts'

import { useT } from '../../shared/i18n'
import { useCreateSaleKind, useSaleKinds, useUpdateSaleKind } from './hooks'

/**
 * Экран «Виды продаж»: что заведение продаёт гостю.
 *
 * ЗАЧЕМ ЭТОТ ЭКРАН ВООБЩЕ ЕСТЬ. Партнёрское условие «купил абонемент — получи
 * ролл в подарок» (docs/07) на одной сумме не строится: ужин на 5 000 ฿
 * и абонемент на 5 000 ฿ для журнала неотличимы. Здесь заведение называет
 * то, что продаёт, — и кассир получает выбор из готового списка.
 *
 * УДАЛЕНИЯ НЕТ, И ЭТО ВИДНО НА ЭКРАНЕ. Вид, на который ссылается журнал,
 * исчезнуть не может: операция ссылалась бы в пустоту. Поэтому здесь
 * «выключить», а не «удалить», и выключенные остаются в списке — чтобы
 * их можно было вернуть, а не заводить заново под тем же именем.
 */
export function SaleKindsPage(): ReactElement {
  const t = useT()
  const query = useSaleKinds()
  const create = useCreateSaleKind()
  const update = useUpdateSaleKind()

  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const submit = (event: FormEvent): void => {
    event.preventDefault()

    const trimmed = name.trim()

    if (trimmed === '') {
      return
    }

    create.mutate(
      { name: trimmed, sortOrder: query.data?.length ?? 0 },
      // Поле очищается только после успеха: на отказе «название занято»
      // человек не должен набирать всё заново.
      { onSuccess: () => setName('') },
    )
  }

  const saveName = (kind: SaleKind): void => {
    if (editing === null) {
      return
    }

    const trimmed = editing.name.trim()

    if (trimmed === '' || trimmed === kind.name) {
      setEditing(null)
      return
    }

    update.mutate({ id: kind.id, patch: { name: trimmed } }, { onSuccess: () => setEditing(null) })
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('saleKinds.title')}</h1>
        <p className="page__subtitle">{t('saleKinds.subtitle')}</p>
      </header>

      <form className="form-row" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{t('saleKinds.new.label')}</span>
          <input
            className="field__input"
            type="text"
            maxLength={80}
            value={name}
            placeholder={t('saleKinds.new.placeholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          className="button button--primary"
          type="submit"
          disabled={name.trim() === '' || create.isPending}
        >
          {create.isPending ? t('common.saving') : t('saleKinds.new.submit')}
        </button>
      </form>

      {create.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {create.error.message}
        </p>
      ) : null}

      {query.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : query.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{query.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : query.data.length === 0 ? (
        <div className="state">
          <p className="state__title">{t('saleKinds.empty.title')}</p>
          <p className="state__hint">{t('saleKinds.empty.hint')}</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('saleKinds.col.name')}</th>
                <th>{t('saleKinds.col.state')}</th>
                <th>{t('saleKinds.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((kind) => (
                <tr key={kind.id}>
                  <td>
                    {editing?.id === kind.id ? (
                      <input
                        className="field__input"
                        type="text"
                        maxLength={80}
                        autoFocus
                        value={editing.name}
                        onChange={(event) => setEditing({ id: kind.id, name: event.target.value })}
                        onBlur={() => saveName(kind)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            saveName(kind)
                          }

                          if (event.key === 'Escape') {
                            setEditing(null)
                          }
                        }}
                      />
                    ) : (
                      kind.name
                    )}
                  </td>
                  <td>
                    <span className={`chip ${kind.isActive ? 'chip--good' : 'chip--muted'}`}>
                      {t(kind.isActive ? 'saleKinds.state.on' : 'saleKinds.state.off')}
                    </span>
                  </td>
                  <td>
                    <button
                      className="button"
                      type="button"
                      disabled={editing !== null}
                      onClick={() => setEditing({ id: kind.id, name: kind.name })}
                    >
                      {t('saleKinds.action.rename')}
                    </button>{' '}
                    <button
                      className="button"
                      type="button"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate({ id: kind.id, patch: { isActive: !kind.isActive } })
                      }}
                    >
                      {t(kind.isActive ? 'saleKinds.action.off' : 'saleKinds.action.on')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {update.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {update.error.message}
        </p>
      ) : null}

      <p className="page__note">{t('saleKinds.note')}</p>
    </section>
  )
}
