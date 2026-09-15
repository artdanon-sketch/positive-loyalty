import { describe, expect, it } from 'vitest'

import { fromReferralDraft, toReferralDraft } from './referral-draft'

describe('Черновик приглашений друзей', () => {
  it('БАЛЛЫ ЗА ДРУГА ПОКАЗЫВАЮТСЯ В БАТАХ И УХОДЯТ В САТАНГАХ', () => {
    expect(toReferralDraft({ enabled: true, reward: 7_500, limit: 3 })).toEqual({
      enabled: true,
      reward: '75',
      limit: '3',
    })

    expect(fromReferralDraft({ enabled: true, reward: '75,5', limit: ' 3 ' })).toEqual({
      ok: true,
      settings: { enabled: true, reward: 7_550, limit: 3 },
    })
  })

  it('ВКЛЮЧЁННАЯ НАГРАДА БЕЗ СУММЫ, С НУЛЁМ ИЛИ СВЕРХ 10 000 ฿ — ПРОБЛЕМА В СУММЕ', () => {
    for (const reward of ['', '0', '10000.01', 'сто']) {
      expect(fromReferralDraft({ enabled: true, reward, limit: '10' })).toEqual({
        ok: false,
        problem: 'reward',
      })
    }
  })

  it('лимит — целое число от 1 до 100', () => {
    for (const limit of ['', '0', '101', '2.5']) {
      expect(fromReferralDraft({ enabled: true, reward: '50', limit })).toEqual({
        ok: false,
        problem: 'limit',
      })
    }
  })

  it('ВЫКЛЮЧЕННЫЕ СОХРАНЯЮТСЯ ВСЕГДА: СПРЯТАННОЕ ПОЛЕ НЕ ЗАПИРАЕТ КНОПКУ', () => {
    expect(fromReferralDraft({ enabled: false, reward: '', limit: '10' })).toEqual({
      ok: true,
      settings: { enabled: false, reward: 0, limit: 10 },
    })
    expect(fromReferralDraft({ enabled: false, reward: 'сто', limit: '500' })).toEqual({
      ok: true,
      settings: { enabled: false, reward: 0, limit: 10 },
    })
    expect(fromReferralDraft({ enabled: false, reward: '40', limit: '5' })).toEqual({
      ok: true,
      settings: { enabled: false, reward: 4_000, limit: 5 },
    })
  })
})
