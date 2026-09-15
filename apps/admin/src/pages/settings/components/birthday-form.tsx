import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { BirthdaySettings } from '@positive/contracts'

import { useCertificates } from '../../../shared/certificates/hooks'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { fromBirthdayDraft, toBirthdayDraft } from '../birthday-draft'
import type { BirthdayDraft, BirthdayProblem } from '../birthday-draft'
import { useSaveBirthdaySettings } from '../hooks'

/**
 * Форма подарка ко дню рождения. docs/02, раздел 5.6.3 · docs/11, У9.
 *
 * Баллы или сертификат из шаблона и окно «за сколько дней до и сколько после».
 * Сертификатов нет — вместо пустого списка подсказка и ссылка туда, где их заводят.
 * Выключено — полей на экране нет, как у приглашений друзей.
 */

const PROBLEMS: Readonly<Record<BirthdayProblem, TranslationKey>> = {
  points: 'birthday.problem.points',
  certificate: 'birthday.problem.certificate',
  window: 'birthday.problem.window',
}

const same = (a: BirthdaySettings, b: BirthdaySettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function BirthdayForm({ initial }: { initial: BirthdaySettings }): ReactElement {
  const t = useT()
  const save = useSaveBirthdaySettings()
  const certificates = useCertificates()
  const [draft, setDraft] = useState<BirthdayDraft>(() => toBirthdayDraft(initial))

  const active = (certificates.data ?? []).filter(
    (certificate) => certificate.isActive || certificate.id === draft.certificateId,
  )
  const checked = fromBirthdayDraft(draft)
  const baseline = save.data ?? initial
  const dirty = !checked.ok || !same(checked.settings, baseline)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!checked.ok || !dirty || save.isPending) {
      return
    }

    save.mutate(checked.settings)
  }

  const days = (field: 'daysBefore' | 'daysAfter', label: TranslationKey): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={`birthday-${field}`}>
        {t(label)}
      </label>
      <input
        id={`birthday-${field}`}
        className="field__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft[field]}
        onChange={(event) => {
          setDraft({ ...draft, [field]: event.target.value })
        }}
      />
    </div>
  )

  return (
    <form className="birthday-form" onSubmit={submit}>
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => {
            setDraft({ ...draft, enabled: event.target.checked })
          }}
        />
        <span className="toggle__text">
          <b>{t('birthday.enabled')}</b>
        </span>
      </label>

      {draft.enabled ? (
        <>
          <div className="form-row">
            <div className="field">
              <label className="field__label" htmlFor="birthday-kind">
                {t('birthday.kind')}
              </label>
              <select
                id="birthday-kind"
                className="field__input"
                value={draft.kind}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    kind: event.target.value === 'CERTIFICATE' ? 'CERTIFICATE' : 'POINTS',
                  })
                }}
              >
                <option value="POINTS">{t('birthday.kind.POINTS')}</option>
                <option value="CERTIFICATE">{t('birthday.kind.CERTIFICATE')}</option>
              </select>
            </div>

            {draft.kind === 'POINTS' ? (
              <div className="field">
                <label className="field__label" htmlFor="birthday-points">
                  {t('birthday.points')}
                </label>
                <input
                  id="birthday-points"
                  className="field__input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.points}
                  onChange={(event) => {
                    setDraft({ ...draft, points: event.target.value })
                  }}
                />
              </div>
            ) : active.length === 0 ? (
              <p className="field__hint">
                {t('birthday.noCertificates')}{' '}
                <Link to="/offers?tab=certificates">{t('offers.tab.certificates')}</Link>
              </p>
            ) : (
              <div className="field">
                <label className="field__label" htmlFor="birthday-certificate">
                  {t('birthday.certificate')}
                </label>
                <select
                  id="birthday-certificate"
                  className="field__input"
                  value={draft.certificateId}
                  onChange={(event) => {
                    setDraft({ ...draft, certificateId: event.target.value })
                  }}
                >
                  <option value="">—</option>
                  {active.map((certificate) => (
                    <option key={certificate.id} value={certificate.id}>
                      {certificate.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="form-row">
            {days('daysBefore', 'birthday.daysBefore')}
            {days('daysAfter', 'birthday.daysAfter')}
          </div>
        </>
      ) : null}

      <div className="save-bar">
        {!checked.ok ? (
          <p className="state__hint state__hint--error" role="status">
            {t(PROBLEMS[checked.problem])}
          </p>
        ) : save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : save.isSuccess && !dirty ? (
          <p className="save-bar__ok" role="status">
            {t('birthday.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={!checked.ok || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('birthday.save')}
        </button>
      </div>
    </form>
  )
}
