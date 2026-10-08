import { useState } from 'react'
import type { ReactElement } from 'react'
import type { AutomationKind, AutomationRule } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatDate } from '../../../shared/format/format'
import { fromGiftDraft, toGiftDraft } from '../../../shared/gift/gift-draft'
import { GiftPicker } from '../../../shared/gift/gift-picker'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useAutomation, useSaveAutomation } from '../automation-hooks'

/**
 * Вкладка «Автосценарии» в «Общении». docs/03, раздел 5 · docs/02, раздел 5.4.1.
 *
 * ВЫКЛЮЧЕННЫЙ СЦЕНАРИЙ ВЫГЛЯДИТ ТАК ЖЕ, КАК ВКЛЮЧЁННЫЙ. Иначе владелец никогда
 * не узнает, что система это умеет: пустой экран ничему не учит.
 *
 * ПОРОГ У КАЖДОГО СВОЙ ПО СМЫСЛУ — дни или баты, — поэтому подпись к полю
 * меняется вместе со сценарием, а не остаётся общим словом «порог».
 *
 * «ЖДУТ» — ЦЕНА РЕШЕНИЯ. Сколько гостей подходят прямо сейчас и получат письмо
 * и подарок при следующем запуске. Видно до включения: «сертификат всем
 * спящим» при сорока спящих и при четырёхстах — разные решения.
 */

const TITLES: Readonly<Record<AutomationKind, TranslationKey>> = {
  SLEEPING: 'automation.sleeping.title',
  JOINED_NO_PURCHASE: 'automation.joined.title',
  SPENT_TOTAL: 'automation.spent.title',
}

const HINTS: Readonly<Record<AutomationKind, TranslationKey>> = {
  SLEEPING: 'automation.sleeping.hint',
  JOINED_NO_PURCHASE: 'automation.joined.hint',
  SPENT_TOTAL: 'automation.spent.hint',
}

/** Когда сценарий снова напишет тому же гостю. */
const ONCE: Readonly<Record<AutomationKind, TranslationKey>> = {
  SLEEPING: 'automation.once.sleeping',
  JOINED_NO_PURCHASE: 'automation.once.joined',
  SPENT_TOTAL: 'automation.once.spent',
}

const THRESHOLDS: Readonly<Record<AutomationKind, TranslationKey>> = {
  SLEEPING: 'automation.threshold.days',
  JOINED_NO_PURCHASE: 'automation.threshold.days',
  SPENT_TOTAL: 'automation.threshold.baht',
}

/** Сумма показывается в батах, а хранится в сатангах: в поле владелец видит баты. */
const toField = (rule: AutomationRule): string =>
  rule.kind === 'SPENT_TOTAL' ? String(Math.round(rule.threshold / 100)) : String(rule.threshold)

const fromField = (kind: AutomationKind, value: string): number => {
  const parsed = Number.parseInt(value, 10)
  const safe = Number.isFinite(parsed) ? parsed : 0

  return kind === 'SPENT_TOTAL' ? safe * 100 : safe
}

function RuleCard({ rule }: { rule: AutomationRule }): ReactElement {
  const t = useT()
  const save = useSaveAutomation()
  const [threshold, setThreshold] = useState(() => toField(rule))
  const [text, setText] = useState(rule.text)
  const [giftDraft, setGiftDraft] = useState(() => toGiftDraft(rule.gift))
  const gift = fromGiftDraft(giftDraft)

  const submit = (enabled: boolean): void => {
    if (!gift.ok) {
      return
    }

    save.mutate({
      kind: rule.kind,
      input: {
        enabled,
        threshold: fromField(rule.kind, threshold),
        text: text.trim(),
        gift: gift.gift,
      },
    })
  }

  return (
    <article className="review-card" aria-labelledby={`automation-${rule.kind}`}>
      <header className="review-card__head">
        <h3 className="review-card__title" id={`automation-${rule.kind}`}>
          {t(TITLES[rule.kind])}
        </h3>
        <span className={rule.enabled ? 'chip chip--good' : 'chip chip--neutral'}>
          {t(rule.enabled ? 'automation.on' : 'automation.off')}
        </span>
      </header>

      <p className="field__hint">{t(HINTS[rule.kind])}</p>

      <div className="field">
        <label className="field__label" htmlFor={`automation-threshold-${rule.kind}`}>
          {t(THRESHOLDS[rule.kind])}
        </label>
        <input
          className="field__input"
          id={`automation-threshold-${rule.kind}`}
          inputMode="numeric"
          type="text"
          value={threshold}
          onChange={(event) => {
            setThreshold(event.target.value.replace(/\D/g, ''))
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`automation-text-${rule.kind}`}>
          {t('automation.text')}
        </label>
        <textarea
          className="field__input review-card__textarea"
          id={`automation-text-${rule.kind}`}
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
          }}
        />
      </div>

      <GiftPicker
        id={`automation-gift-${rule.kind}`}
        draft={giftDraft}
        problem={gift.ok ? null : gift.problem}
        onChange={setGiftDraft}
      />

      <p className="field__hint">{t(ONCE[rule.kind])}</p>
      <p className="field__hint">
        {fill(t('automation.waiting'), { count: String(rule.waiting) })}
      </p>

      <p className="field__hint">
        {rule.lastRunAt === null
          ? t('automation.never')
          : fill(t('automation.lastRun'), { date: formatDate(rule.lastRunAt) })}
      </p>

      {save.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {save.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          disabled={save.isPending || !gift.ok}
          type="button"
          onClick={() => {
            submit(rule.enabled)
          }}
        >
          {t('automation.save')}
        </button>
        <button
          className={rule.enabled ? 'button' : 'button button--primary'}
          disabled={save.isPending || !gift.ok}
          type="button"
          onClick={() => {
            submit(!rule.enabled)
          }}
        >
          {t(rule.enabled ? 'automation.turnOff' : 'automation.turnOn')}
        </button>
      </div>
    </article>
  )
}

export function AutomationView(): ReactElement {
  const t = useT()
  const rules = useAutomation()

  return (
    <section className="panel" aria-labelledby="automation-title">
      <h2 className="panel__title" id="automation-title">
        {t('automation.title')}
      </h2>
      <p className="field__hint">{t('automation.hint')}</p>

      {rules.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : rules.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{rules.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void rules.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="review-list">
          {rules.data.items.map((rule) => (
            <RuleCard key={rule.kind} rule={rule} />
          ))}
        </div>
      )}
    </section>
  )
}
