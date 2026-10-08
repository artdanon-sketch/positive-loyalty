import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import { useCreateCertificate } from '../../../shared/certificates/hooks'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { BLANK_CERTIFICATE, CERTIFICATE_KINDS, fromCertificateDraft } from '../certificate-draft'
import type { CertificateDraft, CertificateProblem } from '../certificate-draft'

/**
 * Форма нового сертификата — только у владельца. docs/02, раздел 5.11.
 *
 * Что даёт — теми же тремя видами, что подарок в конструкторе акций: скидка в батах,
 * скидка в процентах, позиция в подарок. Название — так его увидит гость и кассир.
 */

const KIND_LABELS: Readonly<Record<CertificateDraft['kind'], TranslationKey>> = {
  FIXED_OFF: 'offerNew.gift.FIXED_OFF',
  PERCENT_OFF: 'offerNew.gift.PERCENT_OFF',
  FREE_ITEM: 'offerNew.gift.FREE_ITEM',
}

const PROBLEMS: Readonly<Record<CertificateProblem, TranslationKey>> = {
  title: 'certificates.problem.title',
  amount: 'certificates.problem.amount',
  percent: 'certificates.problem.percent',
  maxDiscount: 'certificates.problem.maxDiscount',
  itemName: 'certificates.problem.itemName',
  validityDays: 'certificates.problem.validityDays',
}

type TextField = Exclude<keyof CertificateDraft, 'kind' | 'selfClaim'>

export function CertificateForm(): ReactElement {
  const t = useT()
  const create = useCreateCertificate()
  const [draft, setDraft] = useState<CertificateDraft>(BLANK_CERTIFICATE)
  const [touched, setTouched] = useState(false)

  const checked = fromCertificateDraft(draft)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setTouched(true)

    if (!checked.ok || create.isPending) {
      return
    }

    create.mutate(checked.input, {
      onSuccess: () => {
        setDraft(BLANK_CERTIFICATE)
        setTouched(false)
      },
    })
  }

  const input = (
    field: TextField,
    label: TranslationKey,
    mode: 'text' | 'decimal' | 'numeric' = 'text',
  ): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={`certificate-${field}`}>
        {t(label)}
      </label>
      <input
        id={`certificate-${field}`}
        className="field__input"
        type="text"
        inputMode={mode}
        autoComplete="off"
        value={draft[field]}
        onChange={(event) => {
          setDraft({ ...draft, [field]: event.target.value })
        }}
      />
    </div>
  )

  return (
    <form
      className="panel certificate-form"
      aria-labelledby="certificate-form-title"
      onSubmit={submit}
    >
      <h2 className="panel__title" id="certificate-form-title">
        {t('certificates.form.title')}
      </h2>

      {input('title', 'certificates.field.title')}

      <div className="field">
        <label className="field__label" htmlFor="certificate-kind">
          {t('certificates.field.kind')}
        </label>
        <select
          id="certificate-kind"
          className="field__input"
          value={draft.kind}
          onChange={(event) => {
            const next = CERTIFICATE_KINDS.find((kind) => kind === event.target.value)

            if (next !== undefined) {
              setDraft({ ...draft, kind: next })
            }
          }}
        >
          {CERTIFICATE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABELS[kind])}
            </option>
          ))}
        </select>
      </div>

      {draft.kind === 'FIXED_OFF' ? input('amount', 'certificates.field.amount', 'decimal') : null}
      {draft.kind === 'PERCENT_OFF' ? (
        <>
          {input('percent', 'certificates.field.percent', 'numeric')}
          {input('maxDiscount', 'certificates.field.maxDiscount', 'decimal')}
        </>
      ) : null}
      {draft.kind === 'FREE_ITEM' ? input('itemName', 'certificates.field.itemName') : null}

      {input('validityDays', 'certificates.field.validityDays', 'numeric')}

      <label className="field field--check" htmlFor="certificate-selfClaim">
        <input
          id="certificate-selfClaim"
          type="checkbox"
          checked={draft.selfClaim}
          onChange={(event) => {
            setDraft({ ...draft, selfClaim: event.target.checked })
          }}
        />
        <span>
          <span className="field__label">{t('certificates.field.selfClaim')}</span>
          <span className="field__hint">{t('certificates.selfClaim.hint')}</span>
        </span>
      </label>

      <div className="save-bar">
        {touched && !checked.ok ? (
          <p className="state__hint state__hint--error" role="status">
            {t(PROBLEMS[checked.problem])}
          </p>
        ) : create.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {create.error.message}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('certificates.create')}
        </button>
      </div>
    </form>
  )
}
