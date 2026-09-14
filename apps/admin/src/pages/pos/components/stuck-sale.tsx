import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { QueuedSale } from '../offline-queue'

/**
 * Один застрявший чек: сколько, кому, почему не ушёл — и что с ним сделать.
 *
 * Телефон — маской: экран планшета видят и гости у стойки.
 *
 * «Убрать» — только через подтверждение. Убранный чек не дойдёт никогда,
 * и гость баллов по нему не получит, если его не провели заново вручную.
 * А если провели — убрать обязательно: иначе, дойдя, он начислит второй раз.
 */
export function StuckSale({
  sale,
  onRetry,
  onDiscard,
}: {
  sale: QueuedSale
  onRetry: (receiptId: string, receiptNumber?: string) => void
  onDiscard: (receiptId: string) => void
}): ReactElement {
  const t = useT()
  const [receiptNumber, setReceiptNumber] = useState(sale.receiptNumber ?? '')
  const [confirming, setConfirming] = useState(false)

  const guest =
    sale.target.kind === 'PHONE'
      ? `${sale.target.phone.slice(0, 3)} •• •• ${sale.target.phone.slice(-4)}`
      : t('pos.stuckList.member')

  const fieldId = `stuck-receipt-${sale.receiptId}`

  return (
    <li className="pos__stuck-item">
      <p className="pos__stuck-head">
        <b>{formatBaht(sale.amount)}</b> · {guest} ·{' '}
        {formatDateTime(new Date(sale.queuedAt).toISOString())}
      </p>

      {sale.lastError === undefined ? null : <p className="pos__error">{sale.lastError}</p>}

      <div className="field">
        <label className="field__label" htmlFor={fieldId}>
          {t('pos.stuckList.receipt')}
        </label>
        <input
          id={fieldId}
          className="field__input"
          type="text"
          autoComplete="off"
          maxLength={64}
          value={receiptNumber}
          onChange={(event) => {
            setReceiptNumber(event.target.value)
          }}
        />
      </div>

      {confirming ? (
        <div
          className="pos__stuck-confirm"
          role="alertdialog"
          aria-label={t('pos.stuckList.confirm')}
        >
          <p className="pos__notice">{t('pos.stuckList.confirm')}</p>
          <div className="pos__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setConfirming(false)
              }}
            >
              {t('pos.stuckList.keep')}
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={() => {
                onDiscard(sale.receiptId)
              }}
            >
              {t('pos.stuckList.discardYes')}
            </button>
          </div>
        </div>
      ) : (
        <div className="pos__actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              setConfirming(true)
            }}
          >
            {t('pos.stuckList.discard')}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              onRetry(sale.receiptId, receiptNumber)
            }}
          >
            {t('pos.stuckList.retry')}
          </button>
        </div>
      )}
    </li>
  )
}
