import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PartnershipDetail, TermDirection } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { TermCard } from './term-card'
import { TermForm } from './term-form'

/**
 * Условия в две колонки: «Мы дарим их гостям» и «Они дарят нашим гостям»
 * (docs/07, раздел 10). Партнёрство редко бывает симметричным, и две колонки
 * сразу показывают, кто кому сколько даёт.
 */

const COLUMNS: ReadonlyArray<{ direction: TermDirection; title: TranslationKey }> = [
  { direction: 'WE_GIVE', title: 'partner.terms.weGive' },
  { direction: 'THEY_GIVE', title: 'partner.terms.theyGive' },
]

export function PartnerTerms({
  detail,
  isOwner,
}: {
  detail: PartnershipDetail
  isOwner: boolean
}): ReactElement {
  const t = useT()
  const [proposing, setProposing] = useState(false)

  const name = detail.partner.brandName ?? t('partner.fallbackName')
  // Условия обсуждают там же, где можно писать: после принятия и до расторжения.
  const engaged = detail.actions.message

  return (
    <section className="panel" aria-labelledby="partner-terms-title">
      <div className="panel__row">
        <h2 className="panel__title" id="partner-terms-title">
          {t('partner.terms.title')}
        </h2>
        {isOwner && engaged && !proposing ? (
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              setProposing(true)
            }}
          >
            {t('partner.terms.propose')}
          </button>
        ) : null}
      </div>

      {!engaged && detail.terms.length === 0 ? (
        <p className="state__hint">{t('partner.terms.waitEngaged')}</p>
      ) : null}

      {proposing ? (
        <TermForm
          partnershipId={detail.id}
          partnerName={name}
          onDone={() => {
            setProposing(false)
          }}
        />
      ) : null}

      <div className="terms-columns">
        {COLUMNS.map((column) => {
          const terms = detail.terms.filter((term) => term.direction === column.direction)

          return (
            <div key={column.direction} className="terms-column">
              <h3 className="guest-card__section">{t(column.title)}</h3>
              {terms.length === 0 ? (
                <p className="field__hint">{t('partner.terms.none')}</p>
              ) : (
                terms.map((term) => (
                  <TermCard
                    key={term.id}
                    partnershipId={detail.id}
                    term={term}
                    partnerName={name}
                    isOwner={isOwner}
                  />
                ))
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
