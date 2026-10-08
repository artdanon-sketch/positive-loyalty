import { describe, expect, it } from 'vitest'

import { BLANK_CERTIFICATE, fromCertificateDraft } from './certificate-draft'

describe('Черновик сертификата', () => {
  it('СЕРТИФИКАТ НА 500 ฿: НОМИНАЛ УХОДИТ В САТАНГАХ, СРОК — ЧИСЛОМ', () => {
    expect(
      fromCertificateDraft({ ...BLANK_CERTIFICATE, title: ' Сертификат ', amount: '500' }),
    ).toEqual({
      ok: true,
      input: {
        title: 'Сертификат',
        value: { kind: 'FIXED_OFF', amount: 50_000 },
        validityDays: 30,
        selfClaim: false,
      },
    })
  })

  it('ПРОМО: галочка self-claim уходит в шаблон', () => {
    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Промо',
        amount: '500',
        selfClaim: true,
      }),
    ).toMatchObject({ ok: true, input: { selfClaim: true } })
  })

  it('процент — с потолком и без, подарок — названием', () => {
    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Скидка',
        kind: 'PERCENT_OFF',
        percent: '10',
        maxDiscount: '300',
      }),
    ).toMatchObject({
      ok: true,
      input: { value: { kind: 'PERCENT_OFF', percent: 10, maxDiscount: 30_000 } },
    })

    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Скидка',
        kind: 'PERCENT_OFF',
        percent: '10',
      }),
    ).toMatchObject({ ok: true, input: { value: { maxDiscount: null } } })

    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Десерт',
        kind: 'FREE_ITEM',
        itemName: 'Чизкейк',
      }),
    ).toMatchObject({ ok: true, input: { value: { kind: 'FREE_ITEM', itemName: 'Чизкейк' } } })
  })

  it('ПЕРВАЯ ПРОБЛЕМА ПО ПОРЯДКУ ПОЛЕЙ: НАЗВАНИЕ, НОМИНАЛ, СРОК', () => {
    expect(fromCertificateDraft({ ...BLANK_CERTIFICATE, title: 'С' })).toEqual({
      ok: false,
      problem: 'title',
    })
    expect(fromCertificateDraft({ ...BLANK_CERTIFICATE, title: 'Сертификат' })).toEqual({
      ok: false,
      problem: 'amount',
    })
    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Скидка',
        kind: 'PERCENT_OFF',
        percent: '101',
      }),
    ).toEqual({ ok: false, problem: 'percent' })
    expect(
      fromCertificateDraft({
        ...BLANK_CERTIFICATE,
        title: 'Сертификат',
        amount: '500',
        validityDays: '366',
      }),
    ).toEqual({ ok: false, problem: 'validityDays' })
  })
})
