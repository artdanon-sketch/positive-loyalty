import type { ReactElement } from 'react'

import { useT } from '../i18n'
import type { PromoTermsDraft, PromoTermsProblem } from './promo-terms-draft'

/**
 * Поля условий промо: «забрать можно с», «по», «всего штук».
 *
 * Одни и те же в форме нового сертификата и в правке готового — владелец
 * продлевает промо тем же полем, которым его заводил.
 */
export function PromoTermsFields({
  id,
  draft,
  problem,
  onChange,
}: {
  id: string
  draft: PromoTermsDraft
  problem: PromoTermsProblem | null
  onChange: (draft: PromoTermsDraft) => void
}): ReactElement {
  const t = useT()

  return (
    <div className="promo-terms">
      <div className="form-row">
        <div className="field">
          <label className="field__label" htmlFor={`${id}-starts`}>
            {t('certificates.promoTerms.startsOn')}
          </label>
          <input
            id={`${id}-starts`}
            className="field__input"
            type="date"
            aria-invalid={problem === 'promoDates'}
            value={draft.startsOn}
            onChange={(event) => {
              onChange({ ...draft, startsOn: event.target.value })
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-ends`}>
            {t('certificates.promoTerms.endsOn')}
          </label>
          <input
            id={`${id}-ends`}
            className="field__input"
            type="date"
            aria-invalid={problem === 'promoDates'}
            value={draft.endsOn}
            onChange={(event) => {
              onChange({ ...draft, endsOn: event.target.value })
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-limit`}>
            {t('certificates.promoTerms.limit')}
          </label>
          <input
            id={`${id}-limit`}
            className="field__input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={problem === 'promoLimit'}
            value={draft.limit}
            onChange={(event) => {
              onChange({ ...draft, limit: event.target.value.replace(/\D/g, '') })
            }}
          />
        </div>
      </div>
      <p className={problem === null ? 'field__hint' : 'field__hint field__hint--error'}>
        {problem === 'promoDates'
          ? t('certificates.promoTerms.problem.dates')
          : problem === 'promoLimit'
            ? t('certificates.promoTerms.problem.limit')
            : t('certificates.promoTerms.hint')}
      </p>
    </div>
  )
}
