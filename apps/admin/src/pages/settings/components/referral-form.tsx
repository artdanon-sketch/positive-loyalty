import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ReferralSettings } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useSaveReferralSettings } from '../hooks'
import { fromReferralDraft, toReferralDraft } from '../referral-draft'
import type { ReferralDraft, ReferralProblem } from '../referral-draft'

/**
 * Форма приглашений друзей. docs/02, раздел 5.6.2 · docs/11, У6.
 *
 * Баллы за друга — в батах, в сатанги их переводит referral-draft.ts. Выключено —
 * суммы и лимита на экране нет, как у приветственных баллов: настраивать то, что
 * не работает, незачем. Под формой одна строка «что поправить», и кнопка ждёт,
 * пока её не станет; сервер проверяет те же правила сам.
 */

const PROBLEMS: Readonly<Record<ReferralProblem, TranslationKey>> = {
  reward: 'referral.problem.reward',
  limit: 'referral.problem.limit',
}

const same = (a: ReferralSettings, b: ReferralSettings): boolean =>
  a.enabled === b.enabled && a.reward === b.reward && a.limit === b.limit

export function ReferralForm({ initial }: { initial: ReferralSettings }): ReactElement {
  const t = useT()
  const save = useSaveReferralSettings()
  const [draft, setDraft] = useState<ReferralDraft>(() => toReferralDraft(initial))

  const checked = fromReferralDraft(draft)
  const baseline = save.data ?? initial
  const dirty = !checked.ok || !same(checked.settings, baseline)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!checked.ok || !dirty || save.isPending) {
      return
    }

    save.mutate(checked.settings)
  }

  return (
    <form className="referral-form" onSubmit={submit}>
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => {
            setDraft({ ...draft, enabled: event.target.checked })
          }}
        />
        <span className="toggle__text">
          <b>{t('referral.enabled')}</b>
        </span>
      </label>

      {draft.enabled ? (
        <div className="form-row">
          <div className="field">
            <label className="field__label" htmlFor="referral-reward">
              {t('referral.reward')}
            </label>
            <input
              id="referral-reward"
              className="field__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!checked.ok && checked.problem === 'reward'}
              value={draft.reward}
              onChange={(event) => {
                setDraft({ ...draft, reward: event.target.value })
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="referral-limit">
              {t('referral.limit')}
            </label>
            <input
              id="referral-limit"
              className="field__input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={!checked.ok && checked.problem === 'limit'}
              aria-describedby="referral-limit-hint"
              value={draft.limit}
              onChange={(event) => {
                setDraft({ ...draft, limit: event.target.value })
              }}
            />
            <span className="field__hint" id="referral-limit-hint">
              {t('referral.limitHint')}
            </span>
          </div>
        </div>
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
            {t('referral.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={!checked.ok || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('referral.save')}
        </button>
      </div>
    </form>
  )
}
