import type { ReactElement } from 'react'
import type { AdminDashboard } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Три плитки, ровно три (docs/03, раздел 2). Не четыре и не восемь.
 *
 * Третья плитка ТЗ — «Акция недели» — держит место инкрементальности, пока
 * акций в системе нет. Это не подмена: обе отвечают на один вопрос владельца
 * «работает ли программа», и показывать пустую рамку от несуществующей
 * сущности хуже, чем показать то, что посчитано честно.
 *
 * Если контрольная группа мала, инкрементальности нет, и плитки остаётся две.
 * Пустую третью не рисуем — рамка без числа выглядит как сломанный экран.
 */
export function StatTiles({ data }: { data: AdminDashboard }): ReactElement {
  const t = useT()
  const { guestsViaProgram, pointsLiability, incremental } = data

  return (
    <section className="tiles" aria-label={t('overview.tiles.label')}>
      <article className="tile">
        <h2 className="tile__label">{t('overview.tile.guests')}</h2>
        <b className="tile__value">{guestsViaProgram.value}</b>
        <p className="tile__meta">
          {/* Дельта скрыта, пока сравнивать не с чем: `changePct === null`
              означает нуль в прошлом периоде, а не нулевой рост. */}
          {guestsViaProgram.changePct === null || data.isPartialPeriod ? (
            <span className="tile__hint">{t('overview.tile.noComparison')}</span>
          ) : (
            <Delta value={guestsViaProgram.changePct} />
          )}
          <span className="tile__hint">
            {t('overview.tile.newGuests')} {guestsViaProgram.newGuests}
          </span>
        </p>
      </article>

      <article className="tile tile--liability">
        <h2 className="tile__label">{t('overview.tile.liability')}</h2>
        <b className="tile__value">{formatBaht(pointsLiability.value)}</b>
        <p className="tile__meta">
          {/* Подпись задана ТЗ дословно: она превращает непонятную цифру
              в понятный бизнес-смысл. Менять формулировку нельзя. */}
          <span className="tile__hint">{t('overview.tile.liabilityHint')}</span>
        </p>
      </article>

      {incremental === undefined ? null : (
        <article className="tile">
          <h2 className="tile__label">{t('overview.tile.uplift')}</h2>
          <b className="tile__value">
            {incremental.upliftPct > 0 ? '+' : ''}
            {incremental.upliftPct}%
          </b>
          <p className="tile__meta">
            <span className="tile__hint">
              {t('overview.tile.upliftHint')} {formatBaht(incremental.programAvgCheck)} /{' '}
              {formatBaht(incremental.controlAvgCheck)}
            </span>
            <span className="tile__hint">
              {t('overview.tile.controlSize')} {incremental.controlSize}
            </span>
          </p>
        </article>
      )}
    </section>
  )
}

/**
 * Изменение к прошлому периоду.
 *
 * Цвет НЕ единственный носитель смысла (docs/04, раздел 2): рядом всегда
 * стоит знак, а направление читается из самого числа. Дальтоник и чёрно-белая
 * распечатка теряют цвет, но не теряют содержание.
 */
function Delta({ value }: { value: number }): ReactElement {
  const t = useT()
  const isUp = value > 0
  const isFlat = value === 0

  return (
    <span
      className={`delta ${isFlat ? '' : isUp ? 'delta--up' : 'delta--down'}`}
      title={t('overview.tile.vsPrev')}
    >
      {isFlat ? '' : isUp ? '↑ +' : '↓ '}
      {value}%
    </span>
  )
}
