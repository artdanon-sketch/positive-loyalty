import { describe, expect, it } from 'vitest'

import { HealthResponse } from './health.js'

const valid = {
  status: 'ok',
  service: 'api',
  version: '0.0.0',
  uptimeSeconds: 42,
  timestamp: '2026-08-25T07:00:00.000Z',
} as const

/** Пути полей, к которым претензии у валидатора — удобно сравнивать в ожиданиях. */
function issuePaths(input: unknown): string[] {
  const result = HealthResponse.safeParse(input)

  if (result.success) {
    return []
  }

  return result.error.issues.map((issue) => issue.path.join('.'))
}

describe('HealthResponse', () => {
  it('разбирает корректный ответ и выводит типизированные поля', () => {
    const parsed = HealthResponse.parse(valid)

    expect(parsed).toEqual(valid)
    expect(parsed.status).toBe('ok')
    expect(parsed.uptimeSeconds).toBe(42)
  })

  it('принимает нулевой аптайм — сервис только что поднялся', () => {
    expect(HealthResponse.safeParse({ ...valid, uptimeSeconds: 0 }).success).toBe(true)
  })

  it('отклоняет status, отличный от "ok"', () => {
    expect(issuePaths({ ...valid, status: 'degraded' })).toContain('status')
  })

  it('отклоняет пустое имя сервиса и пустую версию', () => {
    expect(issuePaths({ ...valid, service: '' })).toContain('service')
    expect(issuePaths({ ...valid, version: '' })).toContain('version')
  })

  it('отклоняет timestamp, который не разбирается как ISO-8601', () => {
    expect(issuePaths({ ...valid, timestamp: '25.08.2026' })).toContain('timestamp')
    expect(issuePaths({ ...valid, timestamp: 1_756_100_000_000 })).toContain('timestamp')
  })

  it('отклоняет дробный и отрицательный аптайм', () => {
    expect(issuePaths({ ...valid, uptimeSeconds: 1.5 })).toContain('uptimeSeconds')
    expect(issuePaths({ ...valid, uptimeSeconds: -1 })).toContain('uptimeSeconds')
  })

  it('отклоняет пропущенное обязательное поле', () => {
    const { version: _dropped, ...withoutVersion } = valid

    expect(issuePaths(withoutVersion)).toContain('version')
  })

  it('отклоняет не-объект', () => {
    expect(HealthResponse.safeParse(null).success).toBe(false)
    expect(HealthResponse.safeParse('ok').success).toBe(false)
  })

  it('отклоняет лишнее поле — это и проверяет .strict()', () => {
    const result = HealthResponse.safeParse({ ...valid, isAdmin: true })

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
    }
  })
})
