import { describe, expect, it } from 'vitest'

import { fromReferralDraft, levelsExample, toReferralDraft } from './referral-draft'
import type { LevelsDraft } from './referral-draft'

const NO_LEVELS: LevelsDraft = ['', '', '']

describe('Черновик приглашений друзей', () => {
  it('БАЛЛЫ ЗА ДРУГА ПОКАЗЫВАЮТСЯ В БАТАХ И УХОДЯТ В САТАНГАХ', () => {
    expect(toReferralDraft({ enabled: true, reward: 7_500, limit: 3 })).toEqual({
      enabled: true,
      reward: '75',
      limit: '3',
      levels: NO_LEVELS,
    })

    expect(
      fromReferralDraft({ enabled: true, reward: '75,5', limit: ' 3 ', levels: NO_LEVELS }),
    ).toEqual({
      ok: true,
      settings: { enabled: true, reward: 7_550, limit: 3, levels: [0, 0, 0] },
    })
  })

  it('РАЗОВЫЕ БАЛЛЫ СВЕРХ 10 000 ฿ ИЛИ НЕ ЧИСЛОМ — ПРОБЛЕМА В СУММЕ', () => {
    for (const reward of ['10000.01', 'сто']) {
      expect(fromReferralDraft({ enabled: true, reward, limit: '10', levels: NO_LEVELS })).toEqual({
        ok: false,
        problem: 'reward',
      })
    }
  })

  it('ВКЛЮЧЕНО, НО НИ РАЗОВЫХ БАЛЛОВ, НИ ПРОЦЕНТА — ПРИГЛАШАТЬ НЕЗАЧЕМ', () => {
    for (const reward of ['', '0', '0,00']) {
      expect(fromReferralDraft({ enabled: true, reward, limit: '10', levels: NO_LEVELS })).toEqual({
        ok: false,
        problem: 'nothing',
      })
    }
  })

  it('ТОЛЬКО ПРОЦЕНТЫ, БЕЗ РАЗОВЫХ БАЛЛОВ — ЗАКОННО: 5 / 3 / 1, КАК У UDS', () => {
    expect(
      fromReferralDraft({ enabled: true, reward: '', limit: '10', levels: ['5', '3', '0,5'] }),
    ).toEqual({
      ok: true,
      settings: { enabled: true, reward: 0, limit: 10, levels: [5, 3, 0.5] },
    })
  })

  it('ПРОЦЕНТ НА КРУГЕ — ОТ 0 ДО 20, ОДИН ЗНАК ПОСЛЕ ЗАПЯТОЙ', () => {
    for (const bad of ['21', '-1', '2,55', 'пять']) {
      expect(
        fromReferralDraft({ enabled: true, reward: '50', limit: '10', levels: [bad, '', ''] }),
      ).toEqual({ ok: false, problem: 'levels' })
    }
  })

  it('ПРОЦЕНТЫ ТУДА И ОБРАТНО — С ЗАПЯТОЙ, НОЛЬ — ПУСТОЕ ПОЛЕ', () => {
    expect(
      toReferralDraft({ enabled: true, reward: 0, limit: 5, levels: [5, 0, 0.5] }).levels,
    ).toEqual(['5', '', '0,5'])
  })

  it('ПРИМЕР НА ЧЕКЕ ДРУГА В 1 000 ฿ — В САТАНГАХ, ОКРУГЛЕНИЕ ВНИЗ', () => {
    expect(levelsExample([5, 3, 0.5])).toEqual([5_000, 3_000, 500])
  })

  it('лимит — целое число от 1 до 100', () => {
    for (const limit of ['', '0', '101', '2.5']) {
      expect(fromReferralDraft({ enabled: true, reward: '50', limit, levels: NO_LEVELS })).toEqual({
        ok: false,
        problem: 'limit',
      })
    }
  })

  it('ВЫКЛЮЧЕННЫЕ СОХРАНЯЮТСЯ ВСЕГДА: СПРЯТАННОЕ ПОЛЕ НЕ ЗАПИРАЕТ КНОПКУ', () => {
    expect(
      fromReferralDraft({ enabled: false, reward: '', limit: '10', levels: NO_LEVELS }),
    ).toEqual({ ok: true, settings: { enabled: false, reward: 0, limit: 10, levels: [0, 0, 0] } })
    expect(
      fromReferralDraft({ enabled: false, reward: 'сто', limit: '500', levels: ['99', '', ''] }),
    ).toEqual({ ok: true, settings: { enabled: false, reward: 0, limit: 10, levels: [0, 0, 0] } })
    expect(
      fromReferralDraft({ enabled: false, reward: '40', limit: '5', levels: ['5', '', ''] }),
    ).toEqual({
      ok: true,
      settings: { enabled: false, reward: 4_000, limit: 5, levels: [5, 0, 0] },
    })
  })
})
