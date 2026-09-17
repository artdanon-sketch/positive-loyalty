import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht } from '../../../shared/format/baht'
import { useT } from '../../../shared/i18n/i18n-context'
import { HISTORY_LABEL, historyTone, signedPoints } from '../history-labels'
import { useHistory } from '../hooks'

/**
 * «История» на карте гостя. docs/02, раздел 2.11.
 *
 * ОТВЕЧАЕТ НА ВОПРОС «А КУДА ДЕЛОСЬ». Карта показывает, сколько баллов, и молчит
 * о том, за что. Пока цифра растёт, вопросов нет; спор начинается у стойки, когда
 * гость уверен, что баллов было больше.
 *
 * ЗАКРЫТА ПО УМОЛЧАНИЮ. Гость открывает карту ради кода кассиру, и двадцать строк
 * между кодом и баллами — это очередь у стойки. Открывается нажатием и тогда же
 * загружается: пустая история не стоит запроса при каждом открытии карты.
 *
 * СТРАНИЦАМИ ПО ДВАДЦАТЬ. Тянуть всё разом значит заставить телефон ждать ради
 * строк, до которых обычно не доходят.
 */
export function HistoryList(): ReactElement {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const history = useHistory(offset)

  if (!open) {
    return (
      <section className="history">
        <button
          className="history__toggle"
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          {t('history.show')}
        </button>
      </section>
    )
  }

  return (
    <section className="history" aria-labelledby="history-title">
      <h2 className="card__sectionTitle" id="history-title">
        {t('history.title')}
      </h2>

      {history.isPending ? (
        <p className="history__hint" role="status">
          {t('history.loading')}
        </p>
      ) : history.isError ? (
        <p className="history__hint history__hint--error" role="alert">
          {history.error.message}
        </p>
      ) : history.data.items.length === 0 ? (
        <p className="history__hint">{t('history.empty')}</p>
      ) : (
        <>
          <ul className="history__list">
            {history.data.items.map((entry) => (
              <li className="history__item" key={entry.id}>
                <div className="history__main">
                  <span className="history__kind">{t(HISTORY_LABEL[entry.type])}</span>
                  <span className="history__venue">{entry.venue}</span>
                </div>
                <div className="history__side">
                  <span className={`history__points history__points--${historyTone(entry)}`}>
                    {signedPoints(entry.points)}
                  </span>
                  <span className="history__at">
                    {new Date(entry.at).toLocaleDateString()}
                    {entry.basisAmount === null ? '' : ` · ${formatBaht(entry.basisAmount)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {history.data.hasMore || offset > 0 ? (
            <div className="history__pager">
              <button
                className="history__toggle"
                disabled={offset === 0}
                type="button"
                onClick={() => {
                  setOffset(Math.max(0, offset - 20))
                }}
              >
                {t('history.newer')}
              </button>
              <button
                className="history__toggle"
                disabled={!history.data.hasMore}
                type="button"
                onClick={() => {
                  setOffset(offset + 20)
                }}
              >
                {t('history.older')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
