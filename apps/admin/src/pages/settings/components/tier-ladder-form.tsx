import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ProgramMode, TierSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useSaveTierSettings } from '../hooks'
import { fromDraft, newRow, TIERS_LIMIT, toDraft } from '../tier-draft'
import type { TierDraft, TierProblem, TierRowDraft, TierRowField } from '../tier-draft'

/**
 * Форма лестницы статусов и приветственных баллов. docs/02, раздел 5.6.1.
 *
 * Порядок строк — порядок лестницы, снизу вверх: стрелками статус переезжает
 * выше или ниже. Под формой одна строка «что поправить», и кнопка ждёт,
 * пока её не станет; сервер проверяет те же правила сам.
 *
 * Условия и приветственные баллы — в батах; в сатанги их переводит tier-draft.ts.
 *
 * В режиме «скидкой сразу» ставка статуса — процент скидки, и подпись поля
 * говорит именно это: «Начисление, %» там соврало бы владельцу.
 */

const ROW_PROBLEMS: Readonly<Record<TierRowField, TranslationKey>> = {
  name: 'tiers.problem.name',
  earnRate: 'tiers.problem.earnRate',
  redeemRate: 'tiers.problem.redeemRate',
  spentOver: 'tiers.problem.spentOver',
  visitsOver: 'tiers.problem.visitsOver',
  referralsOver: 'tiers.problem.referralsOver',
}

const OTHER_PROBLEMS: Readonly<Record<Exclude<TierProblem['kind'], 'row'>, TranslationKey>> = {
  duplicateName: 'tiers.problem.duplicateName',
  tooMany: 'tiers.problem.tooMany',
  welcomeAmount: 'tiers.problem.welcomeAmount',
}

const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function TierLadderForm({
  initial,
  programMode,
}: {
  initial: TierSettings
  programMode: ProgramMode
}): ReactElement {
  const t = useT()
  const save = useSaveTierSettings()
  const [draft, setDraft] = useState<TierDraft>(() => toDraft(initial))

  const checked = fromDraft(draft)
  // Сравниваем с сохранённым, прогнанным через ту же форму: порядок условий
  // в базе не должен делать форму «изменённой» сразу после открытия.
  const reference = fromDraft(toDraft(save.data ?? initial))
  const dirty =
    checked.ok &&
    (!reference.ok || JSON.stringify(checked.settings) !== JSON.stringify(reference.settings))

  const updateRow = (index: number, next: TierRowDraft): void => {
    setDraft({ ...draft, tiers: draft.tiers.map((row, at) => (at === index ? next : row)) })
  }

  const move = (index: number, by: -1 | 1): void => {
    const tiers = [...draft.tiers]
    const [row] = tiers.splice(index, 1)

    if (row === undefined) {
      return
    }

    tiers.splice(index + by, 0, row)
    setDraft({ ...draft, tiers })
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!checked.ok || !dirty || save.isPending) {
      return
    }

    save.mutate(checked.settings)
  }

  const problemText = (problem: TierProblem): string =>
    problem.kind === 'row'
      ? fill(t(ROW_PROBLEMS[problem.field]), { n: problem.row + 1 })
      : t(OTHER_PROBLEMS[problem.kind])

  const field = (
    row: TierRowDraft,
    index: number,
    name: TierRowField,
    label: TranslationKey,
    mode: 'text' | 'decimal' | 'numeric',
  ): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={`tier-${row.key}-${name}`}>
        {t(label)}
      </label>
      <input
        id={`tier-${row.key}-${name}`}
        className="field__input"
        type="text"
        inputMode={mode}
        autoComplete="off"
        value={row[name]}
        onChange={(event) => {
          updateRow(index, { ...row, [name]: event.target.value })
        }}
      />
    </div>
  )

  return (
    <form className="tier-ladder" onSubmit={submit}>
      {draft.tiers.length === 0 ? <p className="state__hint">{t('tiers.empty')}</p> : null}

      {draft.tiers.map((row, index) => {
        const title = row.name.trim() === '' ? t('tiers.untitled') : row.name.trim()

        return (
          <fieldset className="tier-row" key={row.key}>
            <legend className="tier-row__title">{fill(t('tiers.row'), { n: index + 1 })}</legend>

            <div className="panel__grid">
              {field(row, index, 'name', 'tiers.name', 'text')}
              {field(
                row,
                index,
                'earnRate',
                programMode === 'DISCOUNT' ? 'tiers.discount' : 'tiers.earn',
                'decimal',
              )}
              {field(row, index, 'redeemRate', 'tiers.redeem', 'decimal')}
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={row.hidden}
                onChange={(event) => {
                  updateRow(index, { ...row, hidden: event.target.checked })
                }}
              />
              <span className="toggle__text">
                <b>{t('tiers.hidden')}</b>
              </span>
            </label>

            {row.hidden ? (
              <span className="field__hint">{t('tiers.hiddenHint')}</span>
            ) : (
              <>
                <div className="panel__grid">
                  {field(row, index, 'spentOver', 'tiers.spentOver', 'decimal')}
                  {field(row, index, 'visitsOver', 'tiers.visitsOver', 'numeric')}
                  {field(row, index, 'referralsOver', 'tiers.referralsOver', 'numeric')}
                </div>
                <span className="field__hint">{t('tiers.conditionsHint')}</span>
              </>
            )}

            <div className="row-actions">
              <button
                className="button"
                type="button"
                disabled={index === 0}
                aria-label={fill(t('tiers.up'), { name: title })}
                onClick={() => {
                  move(index, -1)
                }}
              >
                ↑
              </button>
              <button
                className="button"
                type="button"
                disabled={index === draft.tiers.length - 1}
                aria-label={fill(t('tiers.down'), { name: title })}
                onClick={() => {
                  move(index, 1)
                }}
              >
                ↓
              </button>
              <button
                className="button button--danger"
                type="button"
                onClick={() => {
                  setDraft({ ...draft, tiers: draft.tiers.filter((_, at) => at !== index) })
                }}
              >
                {t('tiers.remove')}
              </button>
            </div>
          </fieldset>
        )
      })}

      <div>
        <button
          className="button"
          type="button"
          disabled={draft.tiers.length >= TIERS_LIMIT}
          onClick={() => {
            setDraft({ ...draft, tiers: [...draft.tiers, newRow(newKey())] })
          }}
        >
          {t('tiers.add')}
        </button>
      </div>

      <fieldset className="tier-row">
        <legend className="tier-row__title">{t('tiers.welcome.title')}</legend>

        <label className="toggle">
          <input
            type="checkbox"
            checked={draft.welcomeEnabled}
            onChange={(event) => {
              setDraft({ ...draft, welcomeEnabled: event.target.checked })
            }}
          />
          <span className="toggle__text">
            <b>{t('tiers.welcome.enabled')}</b>
          </span>
        </label>

        {draft.welcomeEnabled ? (
          <div className="panel__grid">
            <div className="field">
              <label className="field__label" htmlFor="tiers-welcome-amount">
                {t('tiers.welcome.amount')}
              </label>
              <input
                id="tiers-welcome-amount"
                className="field__input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft.welcomeAmount}
                onChange={(event) => {
                  setDraft({ ...draft, welcomeAmount: event.target.value })
                }}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="tiers-welcome-trigger">
                {t('tiers.welcome.trigger')}
              </label>
              <select
                id="tiers-welcome-trigger"
                className="field__input"
                value={draft.welcomeTrigger}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    welcomeTrigger:
                      event.target.value === 'ON_JOIN' ? 'ON_JOIN' : 'ON_FIRST_PURCHASE',
                  })
                }}
              >
                <option value="ON_FIRST_PURCHASE">{t('tiers.welcome.ON_FIRST_PURCHASE')}</option>
                <option value="ON_JOIN">{t('tiers.welcome.ON_JOIN')}</option>
              </select>
            </div>
          </div>
        ) : null}

        <span className="field__hint">{t('tiers.welcome.hint')}</span>
      </fieldset>

      <div className="save-bar">
        {!checked.ok ? (
          <p className="state__hint state__hint--error" role="status">
            {problemText(checked.problem)}
          </p>
        ) : save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : save.isSuccess && !dirty ? (
          <p className="save-bar__ok" role="status">
            {t('tiers.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={!checked.ok || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('tiers.save')}
        </button>
      </div>
    </form>
  )
}
