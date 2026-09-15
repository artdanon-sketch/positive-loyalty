import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import { saveTextFile } from '../../../shared/download'
import { fill } from '../../../shared/format/fill'
import { useLocale, useT } from '../../../shared/i18n'
import type { GuestFilters } from '../filters'
import { useExportGuests } from '../hooks'

/**
 * «Выгрузить в CSV» — только у владельца. docs/02, раздел 5.2 · docs/11, У4.
 *
 * Выгружается ровно то, что сейчас на экране: те же фильтры и поиск. Причина
 * обязательна — она попадает в историю действий. Что телефоны в файле будут
 * маской, экран говорит заранее, а не после скачивания.
 */
export function GuestExport({
  filters,
  search,
}: {
  filters: GuestFilters
  search: string
}): ReactElement {
  const t = useT()
  const locale = useLocale()
  const exportGuests = useExportGuests()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState<number | null>(null)

  const ready = reason.trim().length >= 8

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || exportGuests.isPending) {
      return
    }

    exportGuests.mutate(
      {
        reason: reason.trim(),
        filters: { ...filters, ...(search === '' ? {} : { q: search }) },
        locale,
      },
      {
        onSuccess: (csv) => {
          saveTextFile(csv, 'guests.csv', { type: 'text/csv;charset=utf-8', bom: true })
          // Строки без заголовка и завершающего перевода строки.
          setSaved(Math.max(0, csv.split('\r\n').length - 2))
          setReason('')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <div className="guest-export">
        {saved === null ? null : (
          <p className="save-bar__ok" role="status">
            {fill(t('guests.export.done'), { n: saved })}
          </p>
        )}
        <button
          className="button"
          type="button"
          onClick={() => {
            exportGuests.reset()
            setSaved(null)
            setOpen(true)
          }}
        >
          {t('guests.export.open')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="panel guest-export__form"
      aria-labelledby="guest-export-title"
      onSubmit={submit}
    >
      <h2 className="panel__title" id="guest-export-title">
        {t('guests.export.title')}
      </h2>
      <p className="field__hint">{t('guests.export.hint')}</p>

      <div className="field">
        <label className="field__label" htmlFor="guest-export-reason">
          {t('guests.export.reason')}
        </label>
        <input
          id="guest-export-reason"
          className="field__input"
          type="text"
          maxLength={300}
          autoComplete="off"
          aria-describedby="guest-export-reason-hint"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <span className="field__hint" id="guest-export-reason-hint">
          {t('guests.export.reasonHint')}
        </span>
      </div>

      {exportGuests.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {t('guests.export.failed')}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          onClick={() => {
            setOpen(false)
          }}
        >
          {t('guests.export.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={!ready || exportGuests.isPending}
        >
          {exportGuests.isPending ? t('guests.export.running') : t('guests.export.submit')}
        </button>
      </div>
    </form>
  )
}
