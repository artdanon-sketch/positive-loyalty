import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { useCertificates } from '../certificates/hooks'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n'
import type { GiftDraft, GiftKind, GiftProblem } from './gift-draft'

/**
 * Выбор подарка: без подарка, баллы или сертификат. Общий для рассылки
 * и автосценариев — владелец видит одно и то же поле в обоих местах.
 *
 * Сертификатов нет — вместо пустого списка подсказка и ссылка туда, где их
 * заводят, как у подарка ко дню рождения.
 */

const KINDS: ReadonlyArray<{ readonly kind: GiftKind; readonly label: TranslationKey }> = [
  { kind: 'NONE', label: 'campaignGift.kind.NONE' },
  { kind: 'POINTS', label: 'campaignGift.kind.POINTS' },
  { kind: 'CERTIFICATE', label: 'campaignGift.kind.CERTIFICATE' },
]

const PROBLEMS: Readonly<Record<GiftProblem, TranslationKey>> = {
  points: 'campaignGift.problem.points',
  certificate: 'campaignGift.problem.certificate',
}

const kindOf = (value: string): GiftKind =>
  value === 'POINTS' ? 'POINTS' : value === 'CERTIFICATE' ? 'CERTIFICATE' : 'NONE'

export function GiftPicker({
  id,
  draft,
  problem,
  onChange,
}: {
  id: string
  draft: GiftDraft
  problem: GiftProblem | null
  onChange: (draft: GiftDraft) => void
}): ReactElement {
  const t = useT()
  const certificates = useCertificates(draft.kind === 'CERTIFICATE')
  const active = (certificates.data ?? []).filter(
    (certificate) => certificate.isActive || certificate.id === draft.certificateId,
  )

  return (
    <div className="form-row">
      <div className="field">
        <label className="field__label" htmlFor={`${id}-kind`}>
          {t('campaignGift.label')}
        </label>
        <select
          id={`${id}-kind`}
          className="field__input"
          value={draft.kind}
          onChange={(event) => {
            onChange({ ...draft, kind: kindOf(event.target.value) })
          }}
        >
          {KINDS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </div>

      {draft.kind === 'POINTS' ? (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-points`}>
            {t('campaignGift.points')}
          </label>
          <input
            id={`${id}-points`}
            className="field__input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={problem === 'points'}
            value={draft.points}
            onChange={(event) => {
              onChange({ ...draft, points: event.target.value })
            }}
          />
          {problem === 'points' ? (
            <span className="field__hint field__hint--error">{t(PROBLEMS.points)}</span>
          ) : null}
        </div>
      ) : draft.kind === 'CERTIFICATE' ? (
        certificates.isPending ? (
          <p className="field__hint" role="status">
            {t('common.loading')}
          </p>
        ) : active.length === 0 ? (
          <p className="field__hint">
            {t('campaignGift.noCertificates')}{' '}
            <Link to="/offers?tab=certificates">{t('offers.tab.certificates')}</Link>
          </p>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-certificate`}>
              {t('campaignGift.certificate')}
            </label>
            <select
              id={`${id}-certificate`}
              className="field__input"
              aria-invalid={problem === 'certificate'}
              value={draft.certificateId}
              onChange={(event) => {
                onChange({ ...draft, certificateId: event.target.value })
              }}
            >
              <option value="">—</option>
              {active.map((certificate) => (
                <option key={certificate.id} value={certificate.id}>
                  {certificate.title}
                </option>
              ))}
            </select>
            {problem === 'certificate' ? (
              <span className="field__hint field__hint--error">{t(PROBLEMS.certificate)}</span>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}
