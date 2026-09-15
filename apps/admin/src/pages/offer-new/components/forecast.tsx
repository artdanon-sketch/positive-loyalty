import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { draftRules } from '../draft'
import type { OfferDraft } from '../draft'
import { useSimulateOffer } from '../hooks'

/**
 * Прогноз на своей истории. docs/03, раздел 4 · docs/02, раздел 5.3.
 *
 * ПО КНОПКЕ, А НЕ НА КАЖДУЮ БУКВУ. Прогноз гоняет месяц чеков через движок кассы;
 * пересчитывать его на каждый ввод — нагружать сервер ради цифр, на которые
 * никто не успеет посмотреть.
 *
 * УСТАРЕВШИЙ ПРОГНОЗ НЕ ПОКАЗЫВАЕТСЯ. Цифры, посчитанные для «чек от 800 ฿»,
 * под формой с «чек от 500 ฿» — это неправда на экране, по которому решают,
 * запускать ли акцию.
 *
 * ДАННЫХ МАЛО — ТАК И СКАЗАНО. Правдоподобное число хуже честной строки.
 */
export function Forecast({ draft }: { draft: OfferDraft }): ReactElement {
  const t = useT()
  const simulate = useSimulateOffer()
  const [askedFor, setAskedFor] = useState<string | null>(null)

  const rules = draftRules(draft)
  const current = rules.ok ? JSON.stringify(rules.rules) : null
  const stale = askedFor !== null && askedFor !== current
  const result = simulate.isSuccess && !stale ? simulate.data : null

  const run = (): void => {
    if (!rules.ok || simulate.isPending) {
      return
    }

    setAskedFor(JSON.stringify(rules.rules))
    simulate.mutate(rules.rules)
  }

  return (
    <section className="panel" aria-labelledby="offer-forecast-title">
      <h2 className="constructor__section" id="offer-forecast-title">
        {t('offerNew.forecast.title')}
      </h2>
      <p className="field__hint">{t('offerNew.forecast.hint')}</p>

      {result === null ? null : result.insufficientData ? (
        <div>
          <p className="state__title">{t('offerNew.forecast.noData')}</p>
          <p className="state__hint">{result.reason}</p>
        </div>
      ) : (
        <dl className="offer-card__stats">
          <div>
            <dt>{t('offerNew.forecast.guests')}</dt>
            <dd>{result.guests}</dd>
          </div>
          {result.grants === null ? null : (
            <div>
              <dt>{t('offerNew.forecast.grants')}</dt>
              <dd>{result.grants}</dd>
            </div>
          )}
          <div>
            <dt>{t('offerNew.forecast.cost')}</dt>
            <dd>
              {result.cost === null ? t('offerNew.forecast.costUnknown') : formatBaht(result.cost)}
            </dd>
          </div>
        </dl>
      )}

      {stale ? <p className="field__hint">{t('offerNew.forecast.stale')}</p> : null}

      {simulate.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {simulate.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          disabled={!rules.ok || simulate.isPending}
          onClick={run}
        >
          {simulate.isPending ? t('offerNew.forecast.running') : t('offerNew.forecast.run')}
        </button>
      </div>
    </section>
  )
}
