import { describe, expect, it } from 'vitest'

import { decideTransition, effectiveStatus, offerActions } from './offer-lifecycle'
import type { OfferFacts } from './offer-lifecycle'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

const iso = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString()

const offer = (overrides: Partial<OfferFacts> = {}): OfferFacts => ({
  status: 'LIVE',
  type: 'PROMO_ON_CHECK',
  schedule: {},
  isPartner: false,
  ...overrides,
})

describe('Статус акции глазами владельца', () => {
  it('ЗАПУЩЕННАЯ С НАЧАЛОМ ВПЕРЕДИ — ЗАПЛАНИРОВАНА, С КОНЦОМ ПОЗАДИ — ЗАВЕРШЕНА; ГРАНИЦЫ КАК НА КАССЕ', () => {
    expect(effectiveStatus(offer({ schedule: { startsAt: iso(HOUR_MS) } }), NOW)).toBe('SCHEDULED')
    expect(effectiveStatus(offer({ schedule: { startsAt: iso(0) } }), NOW)).toBe('LIVE')
    expect(effectiveStatus(offer({ schedule: { endsAt: iso(0) } }), NOW)).toBe('LIVE')
    expect(effectiveStatus(offer({ schedule: { endsAt: iso(-1) } }), NOW)).toBe('ENDED')
  })

  it('черновик и пауза дат не читают; битое расписание статус не придумывает', () => {
    expect(
      effectiveStatus(offer({ status: 'DRAFT', schedule: { endsAt: iso(-HOUR_MS) } }), NOW),
    ).toBe('DRAFT')
    expect(
      effectiveStatus(offer({ status: 'PAUSED', schedule: { startsAt: iso(HOUR_MS) } }), NOW),
    ).toBe('PAUSED')
    expect(effectiveStatus(offer({ schedule: { startsAt: 'завтра' } }), NOW)).toBe('LIVE')
  })
})

describe('Переходы', () => {
  it('ЧЕРНОВИК И ПАУЗА ЗАПУСКАЮТСЯ; ИДУЩАЯ И ЗАПЛАНИРОВАННАЯ — НА ПАУЗУ; ЗАВЕРШИТЬ МОЖНО ВСЁ НЕЗАВЕРШЁННОЕ', () => {
    expect(decideTransition(offer({ status: 'DRAFT' }), 'publish', NOW)).toEqual({
      kind: 'CHANGE',
      to: 'LIVE',
    })
    expect(decideTransition(offer({ status: 'PAUSED' }), 'publish', NOW)).toEqual({
      kind: 'CHANGE',
      to: 'LIVE',
    })
    expect(decideTransition(offer(), 'pause', NOW)).toEqual({ kind: 'CHANGE', to: 'PAUSED' })
    expect(decideTransition(offer({ schedule: { startsAt: iso(HOUR_MS) } }), 'pause', NOW)).toEqual(
      { kind: 'CHANGE', to: 'PAUSED' },
    )
    expect(decideTransition(offer({ status: 'DRAFT' }), 'end', NOW)).toEqual({
      kind: 'CHANGE',
      to: 'ENDED',
    })
  })

  it('ПОВТОР ТОГО ЖЕ ШАГА — НЕ ОШИБКА, А «УЖЕ ТАК»', () => {
    expect(decideTransition(offer(), 'publish', NOW)).toEqual({ kind: 'SAME' })
    expect(decideTransition(offer({ status: 'PAUSED' }), 'pause', NOW)).toEqual({ kind: 'SAME' })
    expect(decideTransition(offer({ status: 'ENDED' }), 'end', NOW)).toEqual({ kind: 'SAME' })
    expect(decideTransition(offer({ schedule: { endsAt: iso(-HOUR_MS) } }), 'end', NOW)).toEqual({
      kind: 'SAME',
    })
  })

  it('ПАРТНЁРСКАЯ — ТОЛЬКО ЧЕРЕЗ ПАРТНЁРСТВО, КАКИМ БЫ НИ БЫЛ ШАГ', () => {
    for (const action of ['publish', 'pause', 'end'] as const) {
      expect(
        decideTransition(offer({ status: 'PAUSED', isPartner: true }), action, NOW),
      ).toMatchObject({ kind: 'REFUSE', code: 'PARTNER_OFFER' })
    }
  })

  it('отказы: из завершённой хода нет, пауза черновика, запуск того, что касса не считает, и прошедшего срока', () => {
    expect(decideTransition(offer({ status: 'ENDED' }), 'publish', NOW)).toMatchObject({
      code: 'INVALID_TRANSITION',
    })
    expect(
      decideTransition(offer({ schedule: { endsAt: iso(-HOUR_MS) } }), 'pause', NOW),
    ).toMatchObject({ code: 'INVALID_TRANSITION' })
    expect(decideTransition(offer({ status: 'DRAFT' }), 'pause', NOW)).toMatchObject({
      code: 'INVALID_TRANSITION',
    })
    expect(
      decideTransition(offer({ status: 'PAUSED', type: 'STAMP_CARD' }), 'publish', NOW),
    ).toMatchObject({ code: 'OFFER_NOT_SUPPORTED' })
    expect(
      decideTransition(
        offer({ status: 'DRAFT', schedule: { endsAt: iso(-HOUR_MS) } }),
        'publish',
        NOW,
      ),
    ).toMatchObject({ code: 'OFFER_EXPIRED' })
  })
})

describe('Кнопки на карточке', () => {
  it('ВЛАДЕЛЬЦУ — РОВНО ТЕ ШАГИ, КОТОРЫЕ СЕРВЕР ПРИМЕТ; МЕНЕДЖЕРУ И У ПАРТНЁРСКОЙ — НИЧЕГО', () => {
    expect(offerActions(offer(), 'OWNER', NOW)).toEqual({ publish: false, pause: true, end: true })
    expect(offerActions(offer({ status: 'DRAFT' }), 'OWNER', NOW)).toEqual({
      publish: true,
      pause: false,
      end: true,
    })
    expect(offerActions(offer({ status: 'ENDED' }), 'OWNER', NOW)).toEqual({
      publish: false,
      pause: false,
      end: false,
    })
    expect(offerActions(offer(), 'MANAGER', NOW)).toEqual({
      publish: false,
      pause: false,
      end: false,
    })
    expect(offerActions(offer({ isPartner: true }), 'OWNER', NOW)).toEqual({
      publish: false,
      pause: false,
      end: false,
    })
  })
})
