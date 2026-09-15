import { describe, expect, it } from 'vitest'

import { AcceptReferralInput, ReferralSettings } from './referral.js'
import { parseProgramConfig } from './tenant.js'

describe('Приглашения друзей: контракт', () => {
  it('КОД ПРИНИМАЕТСЯ В ЛЮБОМ РЕГИСТРЕ И С ПРОБЕЛАМИ ПО КРАЯМ — И ПРИВОДИТСЯ К ОДНОМУ ВИДУ', () => {
    expect(AcceptReferralInput.parse({ code: ' 7kq2mx4p ' })).toEqual({ code: '7KQ2MX4P' })
  })

  it('похожие знаки, не та длина и лишние поля — не код', () => {
    for (const code of ['7KQ2MX40', 'OKQ2MX4P', '7KQ2MX4', '7KQ2MX4PP', '7KQ-MX4P']) {
      expect(AcceptReferralInput.safeParse({ code }).success).toBe(false)
    }

    expect(AcceptReferralInput.safeParse({ code: '7KQ2MX4P', guestId: 'x' }).success).toBe(false)
  })

  it('ВКЛЮЧЁННАЯ НАГРАДА НЕ МОЖЕТ БЫТЬ НУЛЁМ, ЛИМИТ — ОТ ОДНОГО ДО СТА', () => {
    expect(ReferralSettings.safeParse({ enabled: true, reward: 0, limit: 5 }).success).toBe(false)
    expect(ReferralSettings.safeParse({ enabled: false, reward: 0, limit: 5 }).success).toBe(true)
    expect(ReferralSettings.safeParse({ enabled: true, reward: 5_000, limit: 0 }).success).toBe(
      false,
    )
    expect(ReferralSettings.safeParse({ enabled: true, reward: 5_000, limit: 101 }).success).toBe(
      false,
    )
    expect(ReferralSettings.safeParse({ enabled: true, reward: 1_000_001, limit: 5 }).success).toBe(
      false,
    )
  })

  it('старые настройки без приглашений читаются как «выключено»', () => {
    expect(parseProgramConfig({}).referral).toEqual({ enabled: false, reward: 0, limit: 10 })
  })
})
