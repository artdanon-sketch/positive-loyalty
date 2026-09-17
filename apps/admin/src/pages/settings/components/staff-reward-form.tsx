import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { STAFF_REWARD_RULES } from '@positive/contracts'
import type { StaffRewardBasis, StaffRewardSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useSaveStaffRewardSettings } from '../hooks'
import { forecastReward, fromStaffRewardDraft, toStaffRewardDraft } from '../staff-reward-draft'
import type {
  RewardForecastFacts,
  StaffRewardDraft,
  StaffRewardProblem,
} from '../staff-reward-draft'

/**
 * Доплата кассирам. docs/03, раздел 6.
 *
 * ЖИВОЙ РАСЧЁТ СТОИМОСТИ обязателен: «5% от выручки» звучит безобидно, пока
 * не увидишь, что это тридцать тысяч в месяц. Считается от того, что у заведения
 * уже происходит, — по отчёту за период, а не по выдуманным числам.
 *
 * ПЯТЬ ПРАВИЛ, ПО КОТОРЫМ НЕ ПЛАТЯТ, — серым и без переключателей. Отключить их
 * нельзя: доплата без них становится премией за накрутку, а мы — соучастником.
 */

const PROBLEMS: Readonly<Record<StaffRewardProblem, TranslationKey>> = {
  value: 'staffReward.problem.value',
  shiftCap: 'staffReward.problem.shiftCap',
}

const BASES: ReadonlyArray<{ value: StaffRewardBasis; label: TranslationKey }> = [
  { value: 'PER_NEW_GUEST', label: 'staffReward.basis.PER_NEW_GUEST' },
  { value: 'PCT_OF_POINTS', label: 'staffReward.basis.PCT_OF_POINTS' },
  { value: 'PCT_OF_REVENUE', label: 'staffReward.basis.PCT_OF_REVENUE' },
]

const same = (a: StaffRewardSettings, b: StaffRewardSettings): boolean =>
  a.enabled === b.enabled &&
  a.basis === b.basis &&
  a.value === b.value &&
  a.vesting === b.vesting &&
  a.shiftCap === b.shiftCap

export function StaffRewardForm({
  initial,
  facts,
}: {
  initial: StaffRewardSettings
  /** Чем живёт заведение сейчас — для расчёта стоимости. null — цифр ещё нет. */
  facts: RewardForecastFacts | null
}): ReactElement {
  const t = useT()
  const save = useSaveStaffRewardSettings()
  const [draft, setDraft] = useState<StaffRewardDraft>(() => toStaffRewardDraft(initial))

  const checked = fromStaffRewardDraft(draft)
  const baseline = save.data ?? initial
  const dirty = !checked.ok || !same(checked.settings, baseline)
  const forecast = checked.ok && facts !== null ? forecastReward(checked.settings, facts) : null

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
          <b>{t('staffReward.enabled')}</b>
          <span className="field__hint">{t('staffReward.enabledHint')}</span>
        </span>
      </label>

      {draft.enabled ? (
        <>
          <div className="field">
            <span className="field__label">{t('staffReward.basis')}</span>
            <div className="filter-chips" role="group" aria-label={t('staffReward.basis')}>
              {BASES.map((option) => (
                <button
                  className={
                    draft.basis === option.value
                      ? 'chip chip--good filter-chip'
                      : 'chip chip--neutral filter-chip'
                  }
                  key={option.value}
                  type="button"
                  aria-pressed={draft.basis === option.value}
                  onClick={() => {
                    setDraft({ ...draft, basis: option.value })
                  }}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label className="field__label" htmlFor="staff-reward-value">
                {t(
                  draft.basis === 'PER_NEW_GUEST'
                    ? 'staffReward.valueFixed'
                    : 'staffReward.valuePercent',
                )}
              </label>
              <input
                id="staff-reward-value"
                className="field__input"
                inputMode="decimal"
                value={draft.value}
                onChange={(event) => {
                  setDraft({ ...draft, value: event.target.value })
                }}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="staff-reward-cap">
                {t('staffReward.shiftCap')}
              </label>
              <input
                id="staff-reward-cap"
                className="field__input"
                inputMode="numeric"
                value={draft.shiftCap}
                onChange={(event) => {
                  setDraft({ ...draft, shiftCap: event.target.value })
                }}
              />
            </div>
          </div>

          <div className="field">
            <span className="field__label">{t('staffReward.vesting')}</span>
            <div className="filter-chips" role="group" aria-label={t('staffReward.vesting')}>
              {(['ON_SECOND_VISIT', 'IMMEDIATE'] as const).map((option) => (
                <button
                  className={
                    draft.vesting === option
                      ? 'chip chip--good filter-chip'
                      : 'chip chip--neutral filter-chip'
                  }
                  key={option}
                  type="button"
                  aria-pressed={draft.vesting === option}
                  onClick={() => {
                    setDraft({ ...draft, vesting: option })
                  }}
                >
                  {t(
                    option === 'ON_SECOND_VISIT'
                      ? 'staffReward.vesting.second'
                      : 'staffReward.vesting.now',
                  )}
                </button>
              ))}
            </div>
            <p className="field__hint">{t('staffReward.vestingHint')}</p>
          </div>

          {forecast === null ? null : (
            <p className="field__hint" data-testid="staff-reward-forecast">
              {fill(t('staffReward.forecast'), {
                day: formatBaht(forecast.perDay),
                month: formatBaht(forecast.perMonth),
                pct: forecast.pctOfTurnover === null ? '—' : `${String(forecast.pctOfTurnover)}%`,
              })}
            </p>
          )}
        </>
      ) : null}

      <div className="panel__note">
        <b className="field__label">{t('staffReward.rules')}</b>
        <ul className="field__hint">
          {STAFF_REWARD_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      {checked.ok ? null : (
        <p className="state__hint state__hint--error" role="alert">
          {t(PROBLEMS[checked.problem])}
        </p>
      )}

      {save.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {save.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={!checked.ok || !dirty || save.isPending}
        >
          {t(save.isPending ? 'common.saving' : 'staffReward.save')}
        </button>
      </div>
    </form>
  )
}
