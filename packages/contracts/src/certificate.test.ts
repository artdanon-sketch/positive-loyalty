import { describe, expect, it } from 'vitest'

import { BirthdayConfig, BirthdaySettings, GuestBirthdayInput } from './birthday.js'
import {
  ClaimedPromoCertificate,
  CreateCertificateInput,
  PromoCertificate,
  PromoTerms,
  UpdateCertificateInput,
} from './certificate.js'

describe('Сертификаты: контракт', () => {
  it('ШАБЛОН — НАЗВАНИЕ, ЧТО ДАЁТ И СКОЛЬКО ДЕЙСТВУЕТ; НОМИНАЛ — СКИДКОЙ СУММОЙ', () => {
    expect(
      CreateCertificateInput.parse({
        title: ' Сертификат на 500 ฿ ',
        value: { kind: 'FIXED_OFF', amount: 50_000 },
        validityDays: 30,
      }),
    ).toEqual({
      title: 'Сертификат на 500 ฿',
      value: { kind: 'FIXED_OFF', amount: 50_000 },
      validityDays: 30,
    })
  })

  it('срок — от дня до года, пустая правка — не правка', () => {
    const value = { kind: 'FREE_ITEM', itemName: 'Десерт' }
    expect(
      CreateCertificateInput.safeParse({ title: 'Десерт', value, validityDays: 0 }).success,
    ).toBe(false)
    expect(
      CreateCertificateInput.safeParse({ title: 'Десерт', value, validityDays: 366 }).success,
    ).toBe(false)
    expect(UpdateCertificateInput.safeParse({}).success).toBe(false)
    expect(UpdateCertificateInput.safeParse({ isActive: false }).success).toBe(true)
  })

  it('ПРОМО: флаг self-claim проходит в создании и правке', () => {
    expect(
      CreateCertificateInput.parse({
        title: 'Промо',
        value: { kind: 'FIXED_OFF', amount: 50_000 },
        validityDays: 30,
        selfClaim: true,
      }).selfClaim,
    ).toBe(true)
    expect(UpdateCertificateInput.safeParse({ selfClaim: true }).success).toBe(true)
  })

  it('ВИТРИНА ПРОМО И ОТВЕТ «ЗАБРАТЬ» — со всеми полями', () => {
    expect(
      PromoCertificate.safeParse({
        offerId: '11111111-1111-4111-8111-111111111111',
        tenantId: 't1',
        venue: 'Kata Beach Kitchen',
        title: 'Промо на 500 ฿',
        value: { kind: 'FIXED_OFF', amount: 50_000 },
        validityDays: 30,
        howTo: ['Покажите код на кассе'],
        claimed: false,
        endsAt: '2026-10-31T16:59:59.999Z',
        left: 88,
      }).success,
    ).toBe(true)
    expect(
      ClaimedPromoCertificate.safeParse({
        offerId: '11111111-1111-4111-8111-111111111111',
        code: 'ABC123DEF456',
        expiresAt: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(true)
  })
})

describe('День рождения: контракт', () => {
  it('ОКНО — НЕ ШИРЕ ДВУХ НЕДЕЛЬ В КАЖДУЮ СТОРОНУ, НАГРАДА — БАЛЛЫ ИЛИ СЕРТИФИКАТ', () => {
    const base = { enabled: true, daysBefore: 3, daysAfter: 3 }

    expect(
      BirthdaySettings.safeParse({ ...base, reward: { kind: 'POINTS', amount: 10_000 } }).success,
    ).toBe(true)
    expect(
      BirthdaySettings.safeParse({
        ...base,
        reward: { kind: 'CERTIFICATE', certificateId: '11111111-1111-4111-8111-111111111111' },
      }).success,
    ).toBe(true)
    expect(
      BirthdaySettings.safeParse({ ...base, daysAfter: 15, reward: { kind: 'POINTS', amount: 1 } })
        .success,
    ).toBe(false)
    expect(
      BirthdaySettings.safeParse({ ...base, reward: { kind: 'POINTS', amount: 0 } }).success,
    ).toBe(false)
  })

  it('старые настройки без дня рождения — выключено, окно по три дня', () => {
    expect(BirthdayConfig.parse({})).toEqual({
      enabled: false,
      reward: { kind: 'POINTS', amount: 10_000 },
      daysBefore: 3,
      daysAfter: 3,
    })
  })

  it('ДАТА РОЖДЕНИЯ — НЕ ИЗ БУДУЩЕГО И НЕ РАНЬШЕ 1900 ГОДА', () => {
    expect(GuestBirthdayInput.safeParse({ date: '1990-05-17' }).success).toBe(true)
    expect(GuestBirthdayInput.safeParse({ date: '2999-01-01' }).success).toBe(false)
    expect(GuestBirthdayInput.safeParse({ date: '1899-12-31' }).success).toBe(false)
    expect(GuestBirthdayInput.safeParse({ date: '17.05.1990' }).success).toBe(false)
  })
})

describe('Условия промо: контракт', () => {
  it('ПУСТЫЕ УСЛОВИЯ — БЕЗ СРОКА И ТИРАЖА; КОНЕЦ РАНЬШЕ НАЧАЛА — НЕЛЬЗЯ', () => {
    expect(PromoTerms.safeParse({ startsAt: null, endsAt: null, limit: null }).success).toBe(true)
    expect(
      PromoTerms.safeParse({
        startsAt: '2026-10-31T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
        limit: null,
      }).success,
    ).toBe(false)
  })

  it('ТИРАЖ — ЦЕЛОЕ ОТ ОДНОГО ДО МИЛЛИОНА', () => {
    for (const limit of [0, 2.5, 1_000_001]) {
      expect(PromoTerms.safeParse({ startsAt: null, endsAt: null, limit }).success).toBe(false)
    }
    expect(
      UpdateCertificateInput.safeParse({ promo: { startsAt: null, endsAt: null, limit: 100 } })
        .success,
    ).toBe(true)
  })
})
