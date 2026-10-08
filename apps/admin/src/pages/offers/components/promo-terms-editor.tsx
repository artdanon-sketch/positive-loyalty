import { useState } from 'react'
import type { ReactElement } from 'react'
import type { CertificateTemplate } from '@positive/contracts'

import { useUpdateCertificate } from '../../../shared/certificates/hooks'
import {
  fromPromoTermsDraft,
  toPromoTermsDraft,
} from '../../../shared/certificates/promo-terms-draft'
import { PromoTermsFields } from '../../../shared/certificates/promo-terms-fields'
import { useT } from '../../../shared/i18n'

/**
 * Правка условий готового промо: продлить, сдвинуть начало, поменять тираж.
 * docs/02, раздел 5.11.
 *
 * Без неё продление промо означало бы завести новый шаблон — и потерять
 * счётчики «выдано / использовано» старого.
 */
export function PromoTermsEditor({
  certificate,
  onDone,
}: {
  certificate: CertificateTemplate
  onDone: () => void
}): ReactElement {
  const t = useT()
  const update = useUpdateCertificate()
  const [draft, setDraft] = useState(() => toPromoTermsDraft(certificate.promo))
  const checked = fromPromoTermsDraft(draft)

  return (
    <div className="promo-terms-editor">
      <PromoTermsFields
        id={`promo-${certificate.id}`}
        draft={draft}
        problem={checked.ok ? null : checked.problem}
        onChange={setDraft}
      />

      {update.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {update.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={!checked.ok || update.isPending}
          onClick={() => {
            if (!checked.ok) {
              return
            }

            update.mutate(
              { id: certificate.id, input: { promo: checked.terms } },
              { onSuccess: onDone },
            )
          }}
        >
          {update.isPending ? t('common.saving') : t('certificates.promoTerms.save')}
        </button>
        <button className="button" type="button" onClick={onDone}>
          {t('certificates.promoTerms.cancel')}
        </button>
      </div>
    </div>
  )
}
