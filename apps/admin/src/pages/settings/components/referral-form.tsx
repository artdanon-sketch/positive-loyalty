import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { NO_REFERRAL_LEVELS } from '@positive/contracts'
import type { ReferralSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useSaveReferralSettings } from '../hooks'
import { fromReferralDraft, levelsExample, toReferralDraft } from '../referral-draft'
import type { LevelsDraft, ReferralDraft, ReferralProblem } from '../referral-draft'

/**
 * Форма приглашений друзей. docs/02, раздел 5.6.2 · docs/11, У6.
 *
 * Баллы за друга — в батах, в сатанги их переводит referral-draft.ts. Выключено —
 * суммы и лимита на экране нет, как у приветственных баллов: настраивать то, что
 * не работает, незачем. Под формой одна строка «что поправить», и кнопка ждёт,
 * пока её не станет; сервер проверяет те же правила сам.
 *
 * ПРОЦЕНТ С ПОКУПОК — ТРИ КРУГА, КАК У UDS, с примером на чеке друга в 1 000 ฿:
 * «5 %» владелец видит как пятьдесят батов, которые отдаёт с каждой покупки.
 */

const PROBLEMS: Readonly<Record<ReferralProblem, TranslationKey>> = {
  reward: 'referral.problem.reward',
  limit: 'referral.problem.limit',
  levels: 'referral.problem.levels',
  nothing: 'referral.problem.nothing',
}

const LEVEL_LABELS: readonly TranslationKey[] = [
  'referral.level.1',
  'referral.level.2',
  'referral.level.3',
]

const sameLevels = (a: ReferralSettings, b: ReferralSettings): boolean => {
  const left = a.levels ?? NO_REFERRAL_LEVELS
  const right = b.levels ?? NO_REFERRAL_LEVELS

  return left.every((pct, index) => pct === right[index])
}

const same = (a: ReferralSettings, b: ReferralSettings): boolean =>
  a.enabled === b.enabled && a.reward === b.reward && a.limit === b.limit && sameLevels(a, b)

const withLevel = (levels: LevelsDraft, index: number, value: string): LevelsDraft => [
  index === 0 ? value : levels[0],
  index === 1 ? value : levels[1],
  index === 2 ? value : levels[2],
]

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

      {draft.enabled ? (
        <fieldset className="referral-levels">
          <legend className="field__label">{t('referral.levels.title')}</legend>
          <div className="form-row">
            {draft.levels.map((value, index) => (
              <div className="field" key={LEVEL_LABELS[index]}>
                <label className="field__label" htmlFor={`referral-level-${String(index + 1)}`}>
                  {t(LEVEL_LABELS[index] ?? 'referral.level.1')}
                </label>
                <input
                  id={`referral-level-${String(index + 1)}`}
                  className="field__input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  aria-invalid={!checked.ok && checked.problem === 'levels'}
                  value={value}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      levels: withLevel(draft.levels, index, event.target.value),
                    })
                  }}
                />
              </div>
            ))}
          </div>
          <p className="field__hint">{t('referral.levels.hint')}</p>
          {checked.ok && (checked.settings.levels ?? NO_REFERRAL_LEVELS).some((pct) => pct > 0) ? (
            <p className="field__hint" aria-live="polite">
              {(() => {
                const [first = 0, second = 0, third = 0] = levelsExample(
                  checked.settings.levels ?? NO_REFERRAL_LEVELS,
                )
                return fill(t('referral.levels.example'), {
                  l1: formatBaht(first),
                  l2: formatBaht(second),
                  l3: formatBaht(third),
                })
              })()}
            </p>
          ) : null}
        </fieldset>
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
