import type { TierSettings } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { fromDraft, newRow, toDraft } from './tier-draft'
import type { TierDraft } from './tier-draft'

const SETTINGS: TierSettings = {
  tiers: [
    { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 20, hidden: false, conditions: [] },
    {
      id: 'gold',
      name: 'Золото',
      earnRate: 10,
      redeemRate: 50,
      hidden: false,
      conditions: [
        { type: 'SPENT_TOTAL', gt: 1_000_000 },
        { type: 'VISITS_TOTAL', gt: 9 },
      ],
    },
    { id: 'friends', name: 'Друзья', earnRate: 20, redeemRate: 100, hidden: true, conditions: [] },
  ],
  welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_JOIN' },
}

const problemOf = (draft: TierDraft): unknown => {
  const checked = fromDraft(draft)
  return checked.ok ? null : checked.problem
}

const withRow = (patch: Partial<TierDraft['tiers'][number]>, index = 1): TierDraft => {
  const draft = toDraft(SETTINGS)

  return {
    ...draft,
    tiers: draft.tiers.map((row, at) => (at === index ? { ...row, ...patch } : row)),
  }
}

describe('Лестница в форме', () => {
  it('СОХРАНЁННАЯ ЛЕСТНИЦА ПРОХОДИТ ТУДА И ОБРАТНО БЕЗ ИЗМЕНЕНИЙ', () => {
    expect(fromDraft(toDraft(SETTINGS))).toEqual({ ok: true, settings: SETTINGS })
  })

  it('ПОРОГ ОБОРОТА И ПРИВЕТСТВЕННЫЕ — В БАТАХ НА ЭКРАНЕ, В САТАНГАХ НА СЕРВЕРЕ', () => {
    const draft = toDraft(SETTINGS)

    expect(draft.tiers[1]?.spentOver).toBe('10000')
    expect(draft.welcomeAmount).toBe('50')

    const checked = fromDraft({ ...withRow({ spentOver: '12500,5' }), welcomeAmount: '99.99' })

    expect(checked.ok && checked.settings.tiers[1]?.conditions[0]).toEqual({
      type: 'SPENT_TOTAL',
      gt: 1_250_050,
    })
    expect(checked.ok && checked.settings.welcomeBonus.amount).toBe(9_999)
  })

  it('НОВЫЙ СТАТУС ПОЛУЧАЕТ ПЕРВЫЙ СВОБОДНЫЙ ID; ПУСТЫЕ УСЛОВИЯ — ВХОДНОЙ; У СКРЫТОГО УСЛОВИЙ НЕТ', () => {
    const draft = toDraft(SETTINGS)
    const taken = { ...draft.tiers[0], key: 'tier-1', id: 'tier-1', name: 'Бывший' }
    const fresh = { ...newRow('new-row'), name: 'Платина', earnRate: '15', redeemRate: '70' }
    const secret = {
      ...newRow('secret-row'),
      name: 'Тайный',
      earnRate: '1',
      redeemRate: '1',
      hidden: true,
      spentOver: '100',
    }

    const checked = fromDraft({
      ...draft,
      tiers: [taken, ...draft.tiers, fresh, secret] as TierDraft['tiers'],
    })

    expect(checked.ok && checked.settings.tiers.slice(-2)).toEqual([
      {
        id: 'tier-2',
        name: 'Платина',
        earnRate: 15,
        redeemRate: 70,
        hidden: false,
        conditions: [],
      },
      { id: 'tier-3', name: 'Тайный', earnRate: 1, redeemRate: 1, hidden: true, conditions: [] },
    ])
  })
})

describe('Лестница в форме: что поправить', () => {
  it('ПЕРВАЯ ПРОБЛЕМА — ПО ПОРЯДКУ ПОЛЕЙ: НАЗВАНИЕ, СТАВКИ, УСЛОВИЯ', () => {
    expect(problemOf(withRow({ name: ' ' }))).toEqual({ kind: 'row', row: 1, field: 'name' })
    expect(problemOf(withRow({ earnRate: '51' }))).toEqual({
      kind: 'row',
      row: 1,
      field: 'earnRate',
    })
    expect(problemOf(withRow({ redeemRate: '' }))).toEqual({
      kind: 'row',
      row: 1,
      field: 'redeemRate',
    })
    expect(problemOf(withRow({ visitsOver: '2.5' }))).toEqual({
      kind: 'row',
      row: 1,
      field: 'visitsOver',
    })
  })

  it('ДВА СТАТУСА С ОДНИМ НАЗВАНИЕМ ГОСТЬ НЕ РАЗЛИЧИТ — БЕЗ УЧЁТА РЕГИСТРА', () => {
    expect(problemOf(withRow({ name: 'гость' }))).toEqual({ kind: 'duplicateName' })
  })

  it('включённые приветственные баллы — не ноль и не больше 10 000 ฿; выключенные могут быть пустыми', () => {
    const draft = toDraft(SETTINGS)

    expect(problemOf({ ...draft, welcomeAmount: '' })).toEqual({ kind: 'welcomeAmount' })
    expect(problemOf({ ...draft, welcomeAmount: '10000.01' })).toEqual({ kind: 'welcomeAmount' })
    expect(problemOf({ ...draft, welcomeEnabled: false, welcomeAmount: '' })).toBeNull()
  })

  it('не больше десяти статусов', () => {
    const draft = toDraft(SETTINGS)
    const many = Array.from({ length: 11 }, (_, index) => ({
      ...newRow(`row-${String(index)}`),
      name: `Статус ${String(index)}`,
      earnRate: '1',
      redeemRate: '1',
    }))

    expect(problemOf({ ...draft, tiers: many })).toEqual({ kind: 'tooMany' })
  })
})
