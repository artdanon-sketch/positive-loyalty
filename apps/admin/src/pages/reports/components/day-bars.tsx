import { useId, useState } from 'react'
import type { ReactElement } from 'react'

import { formatDay, tickStep } from '../../../shared/format/day'
import { useT } from '../../../shared/i18n'

/**
 * Один ряд по дням: столбцы или таблица. docs/03, раздел 2 — те же правила,
 * что у графика «Гости по дням»: своя разметка без библиотеки графиков, дни
 * без событий — нулевыми столбцами, таблица — равноправная подача для чтения
 * с экрана.
 */
export function DayBars({
  title,
  days,
  format,
}: {
  title: string
  days: ReadonlyArray<{ readonly date: string; readonly value: number }>
  format: (value: number) => string
}): ReactElement {
  const t = useT()
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()

  const max = Math.max(1, ...days.map((day) => day.value))

  return (
    <section className="chart" aria-labelledby={titleId}>
      <header className="chart__head">
        <h2 className="chart__title" id={titleId}>
          {title}
        </h2>
        <div className="chart__side">
          <button
            className="button button--ghost"
            type="button"
            aria-pressed={asTable}
            onClick={() => {
              setAsTable((value) => !value)
            }}
          >
            {asTable ? t('overview.days.asChart') : t('overview.days.asTable')}
          </button>
        </div>
      </header>

      {asTable ? (
        <div className="table-scroll">
          <table className="data-table" aria-labelledby={titleId}>
            <thead>
              <tr>
                <th>{t('overview.days.col.date')}</th>
                <th className="data-table__num">{title}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{formatDay(day.date)}</td>
                  <td className="data-table__num">{format(day.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bars" role="img" aria-label={title}>
          {days.map((day, index) => (
            <span
              className="bars__col"
              key={day.date}
              title={`${formatDay(day.date)} · ${format(day.value)}`}
            >
              <span className="bars__stack">
                <span
                  className="bars__seg bars__seg--new"
                  style={{ height: `${(day.value / max) * 100}%` }}
                />
              </span>
              <span className="bars__tick">
                {index % tickStep(days.length) === 0 ? formatDay(day.date) : ''}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
