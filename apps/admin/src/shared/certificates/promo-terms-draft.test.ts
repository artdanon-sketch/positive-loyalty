import { describe, expect, it } from 'vitest'

import { t } from '../i18n'
import {
  BLANK_PROMO_TERMS,
  describePromoTerms,
  fromPromoTermsDraft,
  toPromoTermsDraft,
} from './promo-terms-draft'

/**
 * «До 31 октября» владелец пишет днём, а сервер хранит мгновение. Сдвиг на
 * сутки здесь — промо, которое кончилось на день раньше обещанного гостям.
 */

describe('Условия промо: черновик', () => {
  it('ПУСТЫЕ ПОЛЯ — БЕЗ СРОКА И БЕЗ ТИРАЖА', () => {
    expect(fromPromoTermsDraft(BLANK_PROMO_TERMS)).toEqual({
      ok: true,
      terms: { startsAt: null, endsAt: null, limit: null },
    })
  })

  it('КОНЕЦ — ПОСЛЕДНИЙ МИГ ДНЯ: В САМ ПОСЛЕДНИЙ ДЕНЬ ЗАБРАТЬ ЕЩЁ МОЖНО', () => {
    const checked = fromPromoTermsDraft({ startsOn: '2026-10-01', endsOn: '2026-10-31', limit: '' })

    expect(checked.ok).toBe(true)
    if (checked.ok) {
      const end = new Date(checked.terms.endsAt ?? '')
      expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([31, 23, 59])
      expect(new Date(checked.terms.startsAt ?? '').getHours()).toBe(0)
    }
  })

  it('ТУДА И ОБРАТНО — ТЕ ЖЕ ДНИ И ТОТ ЖЕ ТИРАЖ', () => {
    const draft = { startsOn: '2026-10-01', endsOn: '2026-10-31', limit: '100' }
    const checked = fromPromoTermsDraft(draft)

    expect(checked.ok && toPromoTermsDraft(checked.terms)).toEqual(draft)
  })

  it('ОДИН ДЕНЬ — ЗАКОННОЕ ПРОМО, А КОНЕЦ РАНЬШЕ НАЧАЛА — НЕТ', () => {
    expect(
      fromPromoTermsDraft({ startsOn: '2026-10-10', endsOn: '2026-10-10', limit: '' }).ok,
    ).toBe(true)
    expect(
      fromPromoTermsDraft({ startsOn: '2026-10-10', endsOn: '2026-10-09', limit: '' }),
    ).toEqual({ ok: false, problem: 'promoDates' })
  })

  it('ТИРАЖ — ЦЕЛОЕ ОТ ОДНОГО ДО МИЛЛИОНА', () => {
    for (const limit of ['0', '-5', 'сто', '1000001']) {
      expect(fromPromoTermsDraft({ startsOn: '', endsOn: '', limit })).toEqual({
        ok: false,
        problem: 'promoLimit',
      })
    }
  })

  it('В СПИСКЕ — СРОК И ОСТАТОК ОДНОЙ СТРОКОЙ', () => {
    expect(describePromoTerms({ startsAt: null, endsAt: null, limit: null }, 3, t)).toBe(
      t('certificates.promoTerms.none'),
    )
    expect(describePromoTerms({ startsAt: null, endsAt: null, limit: 100 }, 12, t)).toContain('88')
  })
})
