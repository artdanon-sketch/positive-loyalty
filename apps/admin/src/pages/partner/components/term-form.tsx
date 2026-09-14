import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type {
  PartnershipReward,
  PartnershipTrigger,
  ProposeTermInput,
  TermDirection,
} from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { usePartnerSaleKinds, useProposeTerm } from '../hooks'
import { describeTerm } from '../term-sentence'

/**
 * Конструктор условия — с живой фразой под полями (docs/10, раздел 5.4).
 *
 * ПОЛЯ ВЫБИРАЮТСЯ ИЗ СПИСКОВ, А НЕ ВВОДЯТСЯ ИДЕНТИФИКАТОРАМИ. Вид продаж —
 * из списка того заведения, где гость покупает: «мы дарим» — список партнёра,
 * «они дарят» — наш.
 *
 * СУММЫ ВВОДЯТСЯ В БАТАХ, УХОДЯТ В САТАНГАХ (железное правило 4). Перевод —
 * в одном месте, при сборке условия.
 *
 * Только то, что сработает: штампов, статусов и баллов при погашении в списках
 * нет — сервер их тоже не примет.
 */

type TriggerType =
  'ON_PURCHASE' | 'ON_SALE_KIND' | 'ON_FIRST_VISIT' | 'ON_NTH_VISIT' | 'ON_MEMBERSHIP'
type RewardKind = 'FREE_ITEM' | 'PERCENT_OFF' | 'FIXED_OFF'

const TRIGGERS: readonly TriggerType[] = [
  'ON_PURCHASE',
  'ON_SALE_KIND',
  'ON_FIRST_VISIT',
  'ON_NTH_VISIT',
  'ON_MEMBERSHIP',
]
const REWARDS: readonly RewardKind[] = ['FREE_ITEM', 'PERCENT_OFF', 'FIXED_OFF']

const TRIGGER_LABELS: Readonly<Record<TriggerType, TranslationKey>> = {
  ON_PURCHASE: 'termForm.trigger.ON_PURCHASE',
  ON_SALE_KIND: 'termForm.trigger.ON_SALE_KIND',
  ON_FIRST_VISIT: 'termForm.trigger.ON_FIRST_VISIT',
  ON_NTH_VISIT: 'termForm.trigger.ON_NTH_VISIT',
  ON_MEMBERSHIP: 'termForm.trigger.ON_MEMBERSHIP',
}

const REWARD_LABELS: Readonly<Record<RewardKind, TranslationKey>> = {
  FREE_ITEM: 'termForm.reward.FREE_ITEM',
  PERCENT_OFF: 'termForm.reward.PERCENT_OFF',
  FIXED_OFF: 'termForm.reward.FIXED_OFF',
}

/** Баты → сатанги. Пусто — ноль. undefined — не число. */
const toMinor = (value: string): number | undefined => {
  const trimmed = value.replace(',', '.').trim()

  if (trimmed === '') {
    return 0
  }

  const number = Number(trimmed)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : undefined
}

const toInt = (value: string, min: number): number | undefined => {
  const trimmed = value.trim()
  const number = Number(trimmed)
  return trimmed !== '' && Number.isInteger(number) && number >= min ? number : undefined
}

/** Пусто — «без ограничения» (null). */
const toOptionalInt = (value: string): number | null | undefined =>
  value.trim() === '' ? null : toInt(value, 1)

export function TermForm({
  partnershipId,
  partnerName,
  onDone,
}: {
  partnershipId: string
  partnerName: string
  onDone: () => void
}): ReactElement {
  const t = useT()
  const kinds = usePartnerSaleKinds(partnershipId)
  const propose = useProposeTerm(partnershipId)

  const [direction, setDirection] = useState<TermDirection>('WE_GIVE')
  const [triggerType, setTriggerType] = useState<TriggerType>('ON_PURCHASE')
  const [minAmount, setMinAmount] = useState('')
  const [saleKindId, setSaleKindId] = useState('')
  const [nth, setNth] = useState('3')
  const [rewardKind, setRewardKind] = useState<RewardKind>('FREE_ITEM')
  const [itemName, setItemName] = useState('')
  const [minCheck, setMinCheck] = useState('')
  const [percent, setPercent] = useState('10')
  const [maxDiscount, setMaxDiscount] = useState('')
  const [amount, setAmount] = useState('')
  const [validity, setValidity] = useState('14')
  const [total, setTotal] = useState('')
  const [daily, setDaily] = useState('10')
  const [perGuest, setPerGuest] = useState('1')

  // Покупают там, где событие: мы дарим — покупают у партнёра, и наоборот.
  const triggerKinds =
    direction === 'WE_GIVE' ? (kinds.data?.theirs ?? []) : (kinds.data?.ours ?? [])
  const kind = triggerKinds.find((option) => option.id === saleKindId) ?? triggerKinds[0] ?? null

  const trigger = ((): PartnershipTrigger | undefined => {
    switch (triggerType) {
      case 'ON_PURCHASE': {
        const value = toMinor(minAmount)
        return value === undefined ? undefined : { type: 'ON_PURCHASE', minAmount: value }
      }
      case 'ON_SALE_KIND': {
        const value = toMinor(minAmount)
        return value === undefined || kind === null
          ? undefined
          : { type: 'ON_SALE_KIND', saleKindId: kind.id, minAmount: value }
      }
      case 'ON_FIRST_VISIT':
        return { type: 'ON_FIRST_VISIT' }
      case 'ON_NTH_VISIT': {
        const n = toInt(nth, 2)
        return n === undefined ? undefined : { type: 'ON_NTH_VISIT', n }
      }
      case 'ON_MEMBERSHIP':
        return { type: 'ON_MEMBERSHIP' }
    }
  })()

  const reward = ((): PartnershipReward | undefined => {
    switch (rewardKind) {
      case 'FREE_ITEM': {
        const check = toMinor(minCheck)
        return itemName.trim() === '' || check === undefined
          ? undefined
          : { kind: 'FREE_ITEM', itemName: itemName.trim(), minCheck: check }
      }
      case 'PERCENT_OFF': {
        const value = Number(percent.replace(',', '.').trim())
        const cap = maxDiscount.trim() === '' ? null : toMinor(maxDiscount)
        return !Number.isFinite(value) || value < 1 || value > 100 || cap === undefined || cap === 0
          ? undefined
          : { kind: 'PERCENT_OFF', percent: value, maxDiscount: cap }
      }
      case 'FIXED_OFF': {
        const value = toMinor(amount)
        const check = toMinor(minCheck)
        return value === undefined || value === 0 || check === undefined
          ? undefined
          : { kind: 'FIXED_OFF', amount: value, minCheck: check }
      }
    }
  })()

  const validityDays = toInt(validity, 1)
  const totalGrants = toOptionalInt(total)
  const dailyCap = toOptionalInt(daily)
  const perGuestCount = toInt(perGuest, 1)

  const draft: ProposeTermInput | null =
    trigger !== undefined &&
    reward !== undefined &&
    validityDays !== undefined &&
    validityDays <= 90 &&
    totalGrants !== undefined &&
    dailyCap !== undefined &&
    perGuestCount !== undefined
      ? {
          direction,
          trigger,
          reward,
          validityDays,
          limits: { totalGrants, perGuest: perGuestCount, dailyCap },
        }
      : null

  const preview =
    draft === null
      ? null
      : describeTerm(
          { ...draft, saleKindName: triggerType === 'ON_SALE_KIND' ? (kind?.name ?? null) : null },
          partnerName,
          t,
        )

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (draft === null || propose.isPending) {
      return
    }

    propose.mutate(draft, { onSuccess: onDone })
  }

  const moneyField = (
    id: string,
    label: TranslationKey,
    value: string,
    onChange: (next: string) => void,
  ): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t(label)}
      </label>
      <input
        id={id}
        className="field__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </div>
  )

  return (
    <form className="term-form" onSubmit={submit}>
      <fieldset className="term-form__group">
        <legend className="field__label">{t('termForm.direction')}</legend>
        <div className="choice">
          {(['WE_GIVE', 'THEY_GIVE'] as const).map((option) => (
            <button
              key={option}
              className={
                direction === option ? 'choice__option choice__option--on' : 'choice__option'
              }
              type="button"
              aria-pressed={direction === option}
              onClick={() => {
                setDirection(option)
              }}
            >
              {t(option === 'WE_GIVE' ? 'termForm.weGive' : 'termForm.theyGive')}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="panel__grid">
        <div className="field">
          <label className="field__label" htmlFor="term-trigger">
            {t('termForm.trigger')}
          </label>
          <select
            id="term-trigger"
            className="field__input"
            value={triggerType}
            onChange={(event) => {
              setTriggerType(event.target.value as TriggerType)
            }}
          >
            {TRIGGERS.map((option) => (
              <option key={option} value={option}>
                {t(TRIGGER_LABELS[option])}
              </option>
            ))}
          </select>
        </div>

        {triggerType === 'ON_SALE_KIND' ? (
          <div className="field">
            <label className="field__label" htmlFor="term-sale-kind">
              {t('termForm.saleKind')}
            </label>
            {triggerKinds.length === 0 ? (
              <span className="field__hint field__hint--error">{t('termForm.noSaleKinds')}</span>
            ) : (
              <select
                id="term-sale-kind"
                className="field__input"
                value={kind?.id ?? ''}
                onChange={(event) => {
                  setSaleKindId(event.target.value)
                }}
              >
                {triggerKinds.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}

        {triggerType === 'ON_PURCHASE' || triggerType === 'ON_SALE_KIND'
          ? moneyField('term-min-amount', 'termForm.minAmount', minAmount, setMinAmount)
          : null}

        {triggerType === 'ON_NTH_VISIT' ? (
          <div className="field">
            <label className="field__label" htmlFor="term-nth">
              {t('termForm.n')}
            </label>
            <input
              id="term-nth"
              className="field__input"
              type="text"
              inputMode="numeric"
              value={nth}
              onChange={(event) => {
                setNth(event.target.value)
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="panel__grid">
        <div className="field">
          <label className="field__label" htmlFor="term-reward">
            {t('termForm.reward')}
          </label>
          <select
            id="term-reward"
            className="field__input"
            value={rewardKind}
            onChange={(event) => {
              setRewardKind(event.target.value as RewardKind)
            }}
          >
            {REWARDS.map((option) => (
              <option key={option} value={option}>
                {t(REWARD_LABELS[option])}
              </option>
            ))}
          </select>
        </div>

        {rewardKind === 'FREE_ITEM' ? (
          <div className="field">
            <label className="field__label" htmlFor="term-item">
              {t('termForm.itemName')}
            </label>
            <input
              id="term-item"
              className="field__input"
              type="text"
              maxLength={200}
              value={itemName}
              onChange={(event) => {
                setItemName(event.target.value)
              }}
            />
          </div>
        ) : null}

        {rewardKind === 'PERCENT_OFF' ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="term-percent">
                {t('termForm.percent')}
              </label>
              <input
                id="term-percent"
                className="field__input"
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={(event) => {
                  setPercent(event.target.value)
                }}
              />
            </div>
            {moneyField('term-max-discount', 'termForm.maxDiscount', maxDiscount, setMaxDiscount)}
          </>
        ) : null}

        {rewardKind === 'FIXED_OFF'
          ? moneyField('term-amount', 'termForm.amount', amount, setAmount)
          : null}

        {rewardKind === 'FREE_ITEM' || rewardKind === 'FIXED_OFF'
          ? moneyField('term-min-check', 'termForm.minCheck', minCheck, setMinCheck)
          : null}
      </div>

      <div className="panel__grid">
        {(
          [
            ['term-validity', 'termForm.validity', validity, setValidity],
            ['term-total', 'termForm.total', total, setTotal],
            ['term-daily', 'termForm.daily', daily, setDaily],
            ['term-per-guest', 'termForm.perGuest', perGuest, setPerGuest],
          ] as const
        ).map(([id, label, value, onChange]) => (
          <div key={id} className="field">
            <label className="field__label" htmlFor={id}>
              {t(label)}
            </label>
            <input
              id={id}
              className="field__input"
              type="text"
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                onChange(event.target.value)
              }}
            />
          </div>
        ))}
      </div>

      <div className="example" aria-live="polite">
        <p className="example__title">{t('termForm.preview')}</p>
        {preview === null ? (
          <p className="field__hint field__hint--error">{t('termForm.invalid')}</p>
        ) : (
          <>
            <p className="term-card__sentence">{preview.sentence}</p>
            <p className="term-card__limits">{preview.limits}</p>
          </>
        )}
      </div>

      {propose.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {propose.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="button" type="button" onClick={onDone}>
          {t('termForm.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={draft === null || propose.isPending}
        >
          {propose.isPending ? t('common.saving') : t('termForm.submit')}
        </button>
      </div>
    </form>
  )
}
