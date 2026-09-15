import { useId, useState } from 'react'
import type { ReactElement } from 'react'
import type { DashboardDay } from '@positive/contracts'

import { formatDay, tickStep } from '../../../shared/format/day'
import { useT } from '../../../shared/i18n'

/**
 * График «Гости по дням»: столбцы с накоплением (docs/03, раздел 2).
 *
 * Своя разметка на SVG, а не библиотека графиков. Recharts и подобные весят
 * больше ста килобайт в бандле — CLAUDE.md требует обсуждать такое отдельно,
 * а здесь нужны два вида столбцов и подсказка. Собственная разметка ещё и
 * даёт нормальную доступность: библиотеки рисуют `<div>` без роли и подписи.
 *
 * Переключатель «Таблицей» — требование ТЗ, но не только: график без числовой
 * альтернативы недоступен для чтения с экрана. Таблица здесь не запасной
 * вариант, а вторая равноправная подача.
 */
export function DaysChart({
  days,
  isPartial,
}: {
  days: readonly DashboardDay[]
  isPartial: boolean
}): ReactElement {
  const t = useT()
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()

  const max = Math.max(1, ...days.map((day) => day.new + day.returning))

  return (
    <section className="chart" aria-labelledby={titleId}>
      <header className="chart__head">
        <h2 className="chart__title" id={titleId}>
          {t('overview.days.title')}
        </h2>
        <div className="chart__side">
          {isPartial ? <span className="chart__note">{t('overview.days.fewData')}</span> : null}
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

      <p className="legend">
        <span className="legend__item">
          <span className="legend__swatch legend__swatch--new" aria-hidden="true" />
          {t('overview.days.new')}
        </span>
        <span className="legend__item">
          <span className="legend__swatch legend__swatch--returning" aria-hidden="true" />
          {t('overview.days.returning')}
        </span>
      </p>

      {asTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('overview.days.col.date')}</th>
                <th className="data-table__num">{t('overview.days.new')}</th>
                <th className="data-table__num">{t('overview.days.returning')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{formatDay(day.date)}</td>
                  <td className="data-table__num">{day.new}</td>
                  <td className="data-table__num">{day.returning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bars" role="img" aria-label={t('overview.days.alt')}>
          {days.map((day, index) => (
            <span
              className="bars__col"
              key={day.date}
              // Подсказка по наведению — нативный title: своя всплывашка
              // потребовала бы позиционирования, фокуса и escape, а пользы
              // против нативной не добавляет. Здесь же лежат сами числа —
              // на оси им места нет, а знать их иногда нужно.
              title={`${formatDay(day.date)} · ${t('overview.days.new')} ${day.new} · ${t('overview.days.returning')} ${day.returning}`}
            >
              <span className="bars__stack">
                <span
                  className="bars__seg bars__seg--returning"
                  style={{ height: `${(day.returning / max) * 100}%` }}
                />
                <span
                  className="bars__seg bars__seg--new"
                  style={{ height: `${(day.new / max) * 100}%` }}
                />
              </span>
              {/* Под столбцом ДАТА, а не сумма: график без оси абсцисс
                  не читается — по нему видно форму, но не видно, когда.
                  На длинных периодах подписи прореживаются, иначе они
                  сливаются в серую полосу. */}
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
