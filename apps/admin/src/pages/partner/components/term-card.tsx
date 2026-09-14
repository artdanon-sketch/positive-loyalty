import type { ReactElement } from 'react'
import type { PartnershipTermView } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { TERM_STATUS_LABELS, TERM_STATUS_TONES } from '../../partners/labels'
import { useTermAction } from '../hooks'
import type { TermAction } from '../hooks'
import { describeTerm } from '../term-sentence'

/**
 * Условие — фразой, лимитами и цифрами «выдано / погашено».
 *
 * «Отклонить» и «Отозвать» — одно действие сервера, но разные слова:
 * своё условие отзывают, чужое — отклоняют.
 */
export function TermCard({
  partnershipId,
  term,
  partnerName,
  isOwner,
}: {
  partnershipId: string
  term: PartnershipTermView
  partnerName: string
  isOwner: boolean
}): ReactElement {
  const t = useT()
  const act = useTermAction(partnershipId)
  const { sentence, limits } = describeTerm(term, partnerName, t)

  const buttons: Array<{ action: TermAction; label: TranslationKey; primary: boolean }> = []

  if (term.actions.accept) {
    buttons.push({ action: 'accept', label: 'partner.term.accept', primary: true })
  }
  if (term.actions.reject) {
    buttons.push({
      action: 'reject',
      label: term.proposedByUs ? 'partner.term.withdraw' : 'partner.term.reject',
      primary: false,
    })
  }
  if (term.actions.pause) {
    buttons.push({ action: 'pause', label: 'partner.term.pause', primary: false })
  }
  if (term.actions.resume) {
    buttons.push({ action: 'resume', label: 'partner.term.resume', primary: true })
  }

  return (
    <article className={term.status === 'ENDED' ? 'term-card term-card--closed' : 'term-card'}>
      <p className="term-card__status">
        <span className={`chip ${TERM_STATUS_TONES[term.status]}`}>
          {t(TERM_STATUS_LABELS[term.status])}
        </span>
        {term.status === 'PAUSED' && !term.pausedByUs ? (
          <span className="chip chip--muted">{t('partner.term.pausedByThem')}</span>
        ) : null}
      </p>
      <p className="term-card__sentence">{sentence}</p>
      <p className="term-card__limits">{limits}</p>

      {term.status === 'PROPOSED' ? null : (
        <p className="term-card__stats">
          {t('partner.term.issued')}: {term.grantsIssued} · {t('partner.term.redeemed')}:{' '}
          {term.grantsRedeemed}
        </p>
      )}

      {isOwner && buttons.length > 0 ? (
        <div className="panel__actions">
          {buttons.map((button) => (
            <button
              key={button.action}
              className={button.primary ? 'button button--primary' : 'button'}
              type="button"
              disabled={act.isPending}
              onClick={() => {
                act.mutate({ termId: term.id, action: button.action })
              }}
            >
              {t(button.label)}
            </button>
          ))}
        </div>
      ) : null}

      {act.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {act.error.message}
        </p>
      ) : null}
    </article>
  )
}
