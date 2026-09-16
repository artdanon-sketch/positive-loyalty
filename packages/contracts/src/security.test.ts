import { describe, expect, it } from 'vitest'

import { SuspiciousSettings } from './security-config.js'
import { SecurityHistoryQuery, SuspiciousQuery } from './security.js'
import { ProgramConfig } from './tenant.js'

describe('Безопасность', () => {
  it('ПОРОГ ПОДОЗРИТЕЛЬНЫХ ЧЕКОВ — ОТ 2 ДО 50, ПО УМОЛЧАНИЮ 5', () => {
    expect(ProgramConfig.parse({}).suspicious.maxChecksPerDay).toBe(5)
    expect(SuspiciousSettings.safeParse({ maxChecksPerDay: 5 }).success).toBe(true)
    expect(SuspiciousSettings.safeParse({ maxChecksPerDay: 1 }).success).toBe(false)
    expect(SuspiciousSettings.safeParse({ maxChecksPerDay: 51 }).success).toBe(false)
    expect(SuspiciousSettings.safeParse({ maxChecksPerDay: 4.5 }).success).toBe(false)
  })

  it('ИСТОРИЯ ЛИСТАЕТСЯ НАЗАД ПО МОМЕНТУ, СТРАНИЦА — НЕ БОЛЬШЕ СТА', () => {
    expect(SecurityHistoryQuery.parse({})).toEqual({ limit: 50 })
    expect(SecurityHistoryQuery.parse({ before: '2026-09-16T10:00:00.000Z', limit: '20' })).toEqual(
      { before: '2026-09-16T10:00:00.000Z', limit: 20 },
    )
    expect(SecurityHistoryQuery.safeParse({ limit: '200' }).success).toBe(false)
    expect(SecurityHistoryQuery.safeParse({ before: 'вчера' }).success).toBe(false)
  })

  it('ИСТОРИЮ МОЖНО СУЗИТЬ ДО ОДНОГО ДНЯ И ОДНОГО СОТРУДНИКА', () => {
    const staffId = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

    expect(SecurityHistoryQuery.parse({ day: '2026-09-16', actorId: staffId })).toEqual({
      day: '2026-09-16',
      actorId: staffId,
      limit: 50,
    })
    expect(SecurityHistoryQuery.safeParse({ day: '16.09.2026' }).success).toBe(false)
    expect(SecurityHistoryQuery.safeParse({ day: '2026-02-30' }).success).toBe(false)
    expect(SecurityHistoryQuery.safeParse({ actorId: 'kassir' }).success).toBe(false)
  })

  it('подозрительное — за неделю по умолчанию', () => {
    expect(SuspiciousQuery.parse({})).toEqual({ period: '7d' })
  })
})
