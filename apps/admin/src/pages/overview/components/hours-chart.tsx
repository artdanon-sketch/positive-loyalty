import { useId } from 'react'
import type { ReactElement } from 'react'
import type { DashboardAdvice, DashboardHour } from '@positive/contracts'

import { useT } from '../../../shared/i18n'

/**
 * График «Загрузка по часам»: средний будний день (docs/03, раздел 2).
 *
 * Тихие часы подсвечены другим цветом и обведены пунктиром с подписью —
 * три носителя смысла вместо одного цвета. Границы провала считает сервер:
 * это правило с порогами, то есть бизнес-логика, и в компоненте ей не место
 * (CLAUDE.md). Компонент только рисует то, что ему сказали.
 *
 * Пустые часы в начале и конце суток скрыты: закрытое с полуночи до семи
 * заведение не должно объяснять владельцу, почему ночью в зале никого.
 */
export function HoursChart({
  hourly,
  advice,
}: {
  hourly: readonly DashboardHour[]
  advice: readonly DashboardAdvice[]
}): ReactElement {
  const t = useT()
  const titleId = useId()

  const quiet = advice.find((item) => item.kind === 'QUIET_HOURS')
  const open = openHours(hourly)
  const max = Math.max(0.01, ...open.map((point) => point.guests))

  return (
    <section className="chart" aria-labelledby={titleId}>
      <header className="chart__head">
        <h2 className="chart__title" id={titleId}>
          {t('overview.hours.title')}
        </h2>
        <span className="chart__note">{t('overview.hours.subtitle')}</span>
      </header>

      {open.length === 0 ? (
        <p className="chart__empty">{t('overview.hours.empty')}</p>
      ) : (
        <div className="hours" role="img" aria-label={t('overview.hours.alt')}>
          {open.map((point) => {
            const isQuiet =
              quiet !== undefined && point.hour >= quiet.fromHour && point.hour <= quiet.toHour

            return (
              <span
                className={`hours__col ${isQuiet ? 'hours__col--quiet' : ''}`}
                key={point.hour}
                title={`${String(point.hour).padStart(2, '0')}:00 · ${point.guests}`}
              >
                <span className="hours__bar" style={{ height: `${(point.guests / max) * 100}%` }} />
                <span className="hours__tick">{point.hour}</span>
              </span>
            )
          })}
        </div>
      )}

      {quiet === undefined ? null : (
        <p className="chart__caption">
          {t('overview.hours.quiet')} {String(quiet.fromHour).padStart(2, '0')}:00 —{' '}
          {String(quiet.toHour + 1).padStart(2, '0')}:00
        </p>
      )}
    </section>
  )
}

/**
 * Часы, когда заведение работает: от первого до последнего с гостями.
 *
 * Если гостей нет вовсе, показывать нечего — и это честнее, чем ровная
 * линия нулей во всю ширину, которую легко принять за сломанный график.
 */
function openHours(hourly: readonly DashboardHour[]): readonly DashboardHour[] {
  const active = hourly.filter((point) => point.guests > 0)

  if (active.length === 0) {
    return []
  }

  const from = Math.min(...active.map((point) => point.hour))
  const to = Math.max(...active.map((point) => point.hour))

  return hourly.filter((point) => point.hour >= from && point.hour <= to)
}
