import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PartnershipDetail } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { STATUS_LABELS, STATUS_TONES, VERTICAL_LABELS } from '../../partners/labels'
import { usePartnershipAction } from '../hooks'

/**
 * Шапка партнёрства: имя, статус и действия.
 *
 * «Обсудить» и «Отклонить» — в один тап: они ничего не ломают. «Расторгнуть»
 * и «Заблокировать» — через подтверждение со словами о последствиях:
 * расторжение прекращает подарки, блокировка — навсегда.
 *
 * Входящее приглашение можно заблокировать с жалобой «спам» — галочкой
 * в подтверждении (docs/07, раздел 6.2). Галочка есть, только пока приглашение
 * ждёт нашего ответа: ровно тогда сервер разрешает «Отклонить» и ровно тогда
 * примет жалобу.
 */
export function PartnerHeader({
  detail,
  isOwner,
}: {
  detail: PartnershipDetail
  isOwner: boolean
}): ReactElement {
  const t = useT()
  const act = usePartnershipAction(detail.id)
  const [confirming, setConfirming] = useState<'end' | 'block' | null>(null)
  const [spam, setSpam] = useState(false)

  const name = detail.partner.brandName ?? t('partner.fallbackName')
  const canReport = confirming === 'block' && detail.actions.decline

  const closeConfirm = (): void => {
    setConfirming(null)
    setSpam(false)
  }

  return (
    <header className="page__head partner-head">
      <div>
        <h1 className="page__title">{name}</h1>
        <p className="partner-head__meta">
          <span className={`chip ${STATUS_TONES[detail.status]}`}>
            {t(STATUS_LABELS[detail.status])}
          </span>
          <span className="chip chip--muted">
            {t(detail.direction === 'INCOMING' ? 'partner.incoming' : 'partner.outgoing')}
          </span>
          {detail.partner.vertical === null ? null : (
            <span className="chip chip--muted">{t(VERTICAL_LABELS[detail.partner.vertical])}</span>
          )}
        </p>
        {detail.endReason === null ? null : (
          <p className="state__hint">
            {t('partner.endReason')}: {detail.endReason}
          </p>
        )}
      </div>

      {isOwner && confirming === null ? (
        <div className="panel__actions">
          {detail.actions.accept ? (
            <button
              className="button button--primary"
              type="button"
              disabled={act.isPending}
              onClick={() => {
                act.mutate({ action: 'accept' })
              }}
            >
              {t('partner.action.accept')}
            </button>
          ) : null}
          {detail.actions.decline ? (
            <button
              className="button"
              type="button"
              disabled={act.isPending}
              onClick={() => {
                act.mutate({ action: 'decline' })
              }}
            >
              {t('partner.action.decline')}
            </button>
          ) : null}
          {detail.actions.end ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                setConfirming('end')
              }}
            >
              {t('partner.action.end')}
            </button>
          ) : null}
          {detail.actions.block ? (
            <button
              className="button button--danger"
              type="button"
              onClick={() => {
                setConfirming('block')
              }}
            >
              {t('partner.action.block')}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming === null ? null : (
        <div className="confirm" role="alertdialog" aria-labelledby="partner-confirm-text">
          <p className="confirm__text" id="partner-confirm-text">
            {t(confirming === 'end' ? 'partner.confirm.end' : 'partner.confirm.block')}
          </p>
          {canReport ? (
            <>
              <label className="toggle confirm__spam">
                <input
                  type="checkbox"
                  checked={spam}
                  aria-describedby="partner-spam-hint"
                  onChange={(event) => {
                    setSpam(event.target.checked)
                  }}
                />
                <span className="toggle__text">{t('partner.confirm.spam')}</span>
              </label>
              <p className="field__hint confirm__hint" id="partner-spam-hint">
                {t('partner.confirm.spamHint')}
              </p>
            </>
          ) : null}
          <div className="panel__actions">
            <button className="button" type="button" onClick={closeConfirm}>
              {t('partner.confirm.no')}
            </button>
            <button
              className="button button--danger"
              type="button"
              disabled={act.isPending}
              onClick={() => {
                act.mutate(
                  { action: confirming, spam: canReport && spam },
                  { onSettled: closeConfirm },
                )
              }}
            >
              {t(confirming === 'end' ? 'partner.action.end' : 'partner.action.block')}
            </button>
          </div>
        </div>
      )}

      {act.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {act.error.message}
        </p>
      ) : null}
    </header>
  )
}
