import { describe, expect, it } from 'vitest'

import { fromBirthdayDraft, toBirthdayDraft } from './birthday-draft'

const CERTIFICATE = '81818181-8181-4818-8818-818181818181'

describe('Черновик подарка ко дню рождения', () => {
  it('БАЛЛЫ ПОКАЗЫВАЮТСЯ В БАТАХ И УХОДЯТ В САТАНГАХ', () => {
    expect(
      toBirthdayDraft({
        enabled: true,
        reward: { kind: 'POINTS', amount: 15_000 },
        daysBefore: 3,
        daysAfter: 5,
      }),
    ).toEqual({
      enabled: true,
      kind: 'POINTS',
      points: '150',
      certificateId: '',
      daysBefore: '3',
      daysAfter: '5',
    })

    expect(
      fromBirthdayDraft({
        enabled: true,
        kind: 'POINTS',
        points: '150',
        certificateId: '',
        daysBefore: '3',
        daysAfter: '5',
      }),
    ).toEqual({
      ok: true,
      settings: {
        enabled: true,
        reward: { kind: 'POINTS', amount: 15_000 },
        daysBefore: 3,
        daysAfter: 5,
      },
    })
  })

  it('СЕРТИФИКАТ НЕ ВЫБРАН, БАЛЛОВ НЕТ, ОКНО ШИРЕ ДВУХ НЕДЕЛЬ — ПРОБЛЕМА', () => {
    const base = {
      enabled: true,
      points: '100',
      certificateId: '',
      daysBefore: '3',
      daysAfter: '3',
    }

    expect(fromBirthdayDraft({ ...base, kind: 'CERTIFICATE' })).toEqual({
      ok: false,
      problem: 'certificate',
    })
    expect(fromBirthdayDraft({ ...base, kind: 'POINTS', points: '0' })).toEqual({
      ok: false,
      problem: 'points',
    })
    expect(fromBirthdayDraft({ ...base, kind: 'POINTS', daysAfter: '15' })).toEqual({
      ok: false,
      problem: 'window',
    })
    expect(
      fromBirthdayDraft({ ...base, kind: 'CERTIFICATE', certificateId: CERTIFICATE }),
    ).toMatchObject({
      ok: true,
      settings: { reward: { kind: 'CERTIFICATE', certificateId: CERTIFICATE } },
    })
  })

  it('ВЫКЛЮЧЕННЫЙ ПОДАРОК СОХРАНЯЕТСЯ ВСЕГДА: СПРЯТАННОЕ ПОЛЕ НЕ ЗАПИРАЕТ КНОПКУ', () => {
    expect(
      fromBirthdayDraft({
        enabled: false,
        kind: 'CERTIFICATE',
        points: 'сто',
        certificateId: '',
        daysBefore: '99',
        daysAfter: '',
      }),
    ).toEqual({
      ok: true,
      settings: {
        enabled: false,
        reward: { kind: 'POINTS', amount: 10_000 },
        daysBefore: 3,
        daysAfter: 3,
      },
    })
  })
})
