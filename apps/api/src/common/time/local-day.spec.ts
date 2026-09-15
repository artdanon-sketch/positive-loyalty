import { describe, expect, it } from 'vitest'

import { localDay } from './local-day'

describe('День квоты приглашений', () => {
  it('ПОЛНОЧЬ ПХУКЕТА, А НЕ СЕРВЕРА: в половине второго ночи по Бангкоку уже новый день', () => {
    // 18:30 UTC — это 01:30 следующего дня в Бангкоке (UTC+7).
    expect(localDay('Asia/Bangkok', new Date('2026-09-14T18:30:00Z')).toISOString()).toBe(
      '2026-09-15T00:00:00.000Z',
    )
  })

  it('семь вечера по Бангкоку — ещё сегодня', () => {
    expect(localDay('Asia/Bangkok', new Date('2026-09-14T12:00:00Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    )
  })

  it('битая таймзона в данных не роняет приглашение — день считается по Бангкоку', () => {
    expect(localDay('Mars/Olympus', new Date('2026-09-14T18:30:00Z')).toISOString()).toBe(
      '2026-09-15T00:00:00.000Z',
    )
  })
})
