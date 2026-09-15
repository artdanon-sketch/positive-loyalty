import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import type { AudienceKind, DraftType, GiftKind, OfferDraft } from '../draft'
import { AUDIENCE_LABELS, GIFT_LABELS, TYPE_LABELS, WEEKDAYS } from '../labels'

/**
 * Шаг 2 — условия. docs/03, раздел 4.
 *
 * Порядок полей — порядок вопросов владельца: как назвать, что получает гость,
 * кому и за что, когда. Поля, которые к механике не относятся, не показываются:
 * лимит промокодов у кэшбэка ничего бы не значил.
 */

type TextField = Exclude<
  {
    [K in keyof OfferDraft]: OfferDraft[K] extends string ? K : never
  }[keyof OfferDraft],
  'type' | 'audience' | 'giftKind'
>

const TYPES: readonly DraftType[] = ['PROMO_ON_CHECK', 'CASHBACK']
const GIFTS: readonly GiftKind[] = ['FIXED_OFF', 'PERCENT_OFF', 'FREE_ITEM']
const AUDIENCES: readonly AudienceKind[] = ['ALL', 'NEW', 'TOURIST', 'RESIDENT', 'SLEEPING']

export function RulesForm({
  draft,
  onChange,
}: {
  draft: OfferDraft
  onChange: (next: OfferDraft) => void
}): ReactElement {
  const t = useT()

  const set = (patch: Partial<OfferDraft>): void => {
    onChange({ ...draft, ...patch })
  }

  const input = (
    field: TextField,
    label: TranslationKey,
    options: { mode?: 'text' | 'decimal' | 'numeric'; type?: 'text' | 'time' | 'date' } = {},
  ): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={`offer-${field}`}>
        {t(label)}
      </label>
      <input
        id={`offer-${field}`}
        className="field__input"
        type={options.type ?? 'text'}
        inputMode={options.mode ?? 'text'}
        autoComplete="off"
        value={draft[field]}
        onChange={(event) => {
          onChange({ ...draft, [field]: event.target.value })
        }}
      />
    </div>
  )

  return (
    <div className="panel">
      {input('title', 'offerNew.field.title')}

      <fieldset className="term-form__group">
        <legend className="field__label">{t('offerNew.field.type')}</legend>
        <div className="choice">
          {TYPES.map((option) => (
            <button
              key={option}
              className={
                draft.type === option ? 'choice__option choice__option--on' : 'choice__option'
              }
              type="button"
              aria-pressed={draft.type === option}
              onClick={() => {
                set({ type: option })
              }}
            >
              {t(TYPE_LABELS[option])}
            </button>
          ))}
        </div>
      </fieldset>

      {draft.type === 'CASHBACK' ? (
        <div className="panel__grid">
          {input('cashbackPercent', 'offerNew.field.cashbackPercent', { mode: 'numeric' })}
        </div>
      ) : (
        <div className="panel__grid">
          <div className="field">
            <label className="field__label" htmlFor="offer-giftKind">
              {t('offerNew.field.giftKind')}
            </label>
            <select
              id="offer-giftKind"
              className="field__input"
              value={draft.giftKind}
              onChange={(event) => {
                const next = GIFTS.find((gift) => gift === event.target.value)

                if (next !== undefined) {
                  set({ giftKind: next })
                }
              }}
            >
              {GIFTS.map((gift) => (
                <option key={gift} value={gift}>
                  {t(GIFT_LABELS[gift])}
                </option>
              ))}
            </select>
          </div>

          {draft.giftKind === 'FIXED_OFF'
            ? input('giftAmount', 'offerNew.field.giftAmount', { mode: 'decimal' })
            : null}
          {draft.giftKind === 'PERCENT_OFF' ? (
            <>
              {input('giftPercent', 'offerNew.field.giftPercent', { mode: 'numeric' })}
              {input('giftMaxDiscount', 'offerNew.field.giftMaxDiscount', { mode: 'decimal' })}
            </>
          ) : null}
          {draft.giftKind === 'FREE_ITEM' ? input('giftItem', 'offerNew.field.giftItem') : null}

          {input('validityDays', 'offerNew.field.validityDays', { mode: 'numeric' })}
        </div>
      )}

      <h3 className="constructor__section">{t('offerNew.section.who')}</h3>
      <div className="panel__grid">
        <div className="field">
          <label className="field__label" htmlFor="offer-audience">
            {t('offerNew.field.audience')}
          </label>
          <select
            id="offer-audience"
            className="field__input"
            value={draft.audience}
            onChange={(event) => {
              const next = AUDIENCES.find((audience) => audience === event.target.value)

              if (next !== undefined) {
                set({ audience: next })
              }
            }}
          >
            {AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {t(AUDIENCE_LABELS[audience])}
              </option>
            ))}
          </select>
        </div>

        {draft.audience === 'SLEEPING'
          ? input('sleepingDays', 'offerNew.field.sleepingDays', { mode: 'numeric' })
          : null}
        {input('minCheck', 'offerNew.field.minCheck', { mode: 'decimal' })}
        {draft.type === 'PROMO_ON_CHECK' ? (
          <>
            {input('perGuestQty', 'offerNew.field.perGuestQty', { mode: 'numeric' })}
            {input('totalQty', 'offerNew.field.totalQty', { mode: 'numeric' })}
          </>
        ) : null}
      </div>

      <h3 className="constructor__section">{t('offerNew.section.when')}</h3>
      <fieldset className="term-form__group">
        <legend className="field__label">{t('offerNew.field.weekdays')}</legend>
        <div className="weekdays">
          {WEEKDAYS.map(({ day, label }) => {
            const on = draft.weekdays.includes(day)

            return (
              <button
                key={day}
                className={on ? 'chip chip--good weekday' : 'chip chip--neutral weekday'}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  set({
                    weekdays: on
                      ? draft.weekdays.filter((other) => other !== day)
                      : [...draft.weekdays, day],
                  })
                }}
              >
                {t(label)}
              </button>
            )
          })}
        </div>
        <span className="field__hint">{t('offerNew.weekdaysHint')}</span>
      </fieldset>

      <div className="panel__grid">
        {input('timeFrom', 'offerNew.field.timeFrom', { type: 'time' })}
        {input('timeTo', 'offerNew.field.timeTo', { type: 'time' })}
        {input('startsOn', 'offerNew.field.startsOn', { type: 'date' })}
        {input('endsOn', 'offerNew.field.endsOn', { type: 'date' })}
      </div>
      <span className="field__hint">{t('offerNew.timeHint')}</span>
    </div>
  )
}
