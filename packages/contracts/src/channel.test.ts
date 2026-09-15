import { describe, expect, it } from 'vitest'

import {
  ChannelReportQuery,
  CreateChannelInput,
  JoinVenueInput,
  UpdateChannelInput,
} from './channel.js'
import { ReferralCode } from './referral.js'

describe('Источники трафика: контракт', () => {
  it('КОД ИЗ ССЫЛКИ — ТЕ ЖЕ ВОСЕМЬ ЗНАКОВ, ЧТО У ПРИГЛАШЕНИЙ, В ЛЮБОМ РЕГИСТРЕ', () => {
    expect(JoinVenueInput.parse({ channel: ' tbr2k7qx ' })).toEqual({ channel: 'TBR2K7QX' })
    expect(ReferralCode.parse('tbr2k7qx')).toBe('TBR2K7QX')

    for (const channel of ['TBR2K7Q0', 'TBR2K7Q', 'TBR-K7QX', '']) {
      expect(JoinVenueInput.safeParse({ channel }).success).toBe(false)
    }
  })

  it('название — от одного до шестидесяти знаков, код владелец не присылает', () => {
    expect(CreateChannelInput.parse({ name: ' Табличка на столе ' })).toEqual({
      name: 'Табличка на столе',
    })
    expect(CreateChannelInput.safeParse({ name: '' }).success).toBe(false)
    expect(CreateChannelInput.safeParse({ name: 'x'.repeat(61) }).success).toBe(false)
    expect(CreateChannelInput.safeParse({ name: 'Instagram', code: 'TBR2K7QX' }).success).toBe(
      false,
    )
  })

  it('ПРАВКА БЕЗ ПОЛЕЙ — НЕ ПРАВКА', () => {
    expect(UpdateChannelInput.safeParse({}).success).toBe(false)
    expect(UpdateChannelInput.safeParse({ isActive: false }).success).toBe(true)
  })

  it('отчёт по умолчанию — за месяц', () => {
    expect(ChannelReportQuery.parse({})).toEqual({ period: '30d' })
    expect(ChannelReportQuery.safeParse({ period: '1y' }).success).toBe(false)
  })
})
