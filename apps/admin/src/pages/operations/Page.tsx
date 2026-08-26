import type { AdminLedgerEntry } from '@positive/contracts'
import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht, formatDateTime, formatSignedBaht } from '../../shared/format/format'
import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { useLedgerPage, OPERATIONS_PAGE_SIZE } from './hooks'

/**
 * Экран «Операции»: журнал заведения как он есть.
 * docs/03, раздел 1 — «список операций и гостей, без графиков» (Срез 1).
 */

const TYPE_LABELS: Readonly<Record<AdminLedgerEntry['type'], TranslationKey>> = {
  EARN: 'ops.type.earn',
  REDEEM: 'ops.type.redeem',
  REVERSAL: 'ops.type.reversal',
  EXPIRE: 'ops.type.expire',
  ADJUST: 'ops.type.adjust',
  GRANT: 'ops.type.grant',
}

const TYPE_TONES: Readonly<Record<AdminLedgerEntry['type'], string>> = {
  EARN: 'chip--good',
  REDEEM: 'chip--neutral',
  REVERSAL: 'chip--bad',
  EXPIRE: 'chip--neutral',
  ADJUST: 'chip--neutral',
  GRANT: 'chip--good',
}

export function OperationsPage(): ReactElement {
  const t = useT()
  const [offset, setOffset] = useState(0)
  const query = useLedgerPage(offset)

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('ops.title')}</h1>
        <p className="page__subtitle">{t('ops.subtitle')}</p>
      </header>

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
      ) : query.data.items.length === 0 ? (
        <div className="state">
          <p className="state__title">{t('ops.empty.title')}</p>
          <p className="state__hint">{t('ops.empty.hint')}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('ops.col.when')}</th>
                  <th>{t('ops.col.type')}</th>
                  <th>{t('ops.col.receipt')}</th>
                  <th className="data-table__num">{t('ops.col.amount')}</th>
                  <th className="data-table__num">{t('ops.col.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <span className={`chip ${TYPE_TONES[entry.type]}`}>
                        {t(TYPE_LABELS[entry.type])}
                      </span>
                    </td>
                    <td>{entry.refId ?? '—'}</td>
                    <td
                      className={`data-table__num ${entry.amount > 0 ? 'amount--in' : entry.amount < 0 ? 'amount--out' : ''}`}
                    >
                      {formatSignedBaht(entry.amount)}
                    </td>
                    <td className="data-table__num">{formatBaht(entry.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            offset={offset}
            shown={query.data.items.length}
            total={query.data.total}
            onOffsetChange={setOffset}
          />
        </>
      )}
    </section>
  )
}

function Pager(props: {
  offset: number
  shown: number
  total: number
  onOffsetChange: (offset: number) => void
}): ReactElement {
  const t = useT()
  const from = props.offset + 1
  const to = props.offset + props.shown

  return (
    <nav className="pager" aria-label={t('common.pager.label')}>
      <button
        className="button"
        type="button"
        disabled={props.offset === 0}
        onClick={() => {
          props.onOffsetChange(Math.max(0, props.offset - OPERATIONS_PAGE_SIZE))
        }}
      >
        {t('common.pager.prev')}
      </button>
      <span className="pager__info">
        {from}–{to} {t('common.pager.of')} {props.total}
      </span>
      <button
        className="button"
        type="button"
        disabled={to >= props.total}
        onClick={() => {
          props.onOffsetChange(props.offset + OPERATIONS_PAGE_SIZE)
        }}
      >
        {t('common.pager.next')}
      </button>
    </nav>
  )
}
