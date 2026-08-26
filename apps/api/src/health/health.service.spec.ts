import { Test } from '@nestjs/testing'
import { HealthResponse } from '@positive/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetEnvCache } from '../common/config/env'
import { HealthService } from './health.service'

describe('HealthService', () => {
  let service: HealthService
  const previousVersion = process.env.APP_VERSION

  beforeEach(async () => {
    process.env.APP_VERSION = '1.2.3'
    resetEnvCache()

    // Через тестовый модуль, а не через `new`: так заодно проверяем, что DI
    // видит метаданные декораторов (трансформ swc в vitest.config.ts).
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService],
    }).compile()

    service = moduleRef.get(HealthService)
  })

  afterEach(() => {
    if (previousVersion === undefined) {
      delete process.env.APP_VERSION
    } else {
      process.env.APP_VERSION = previousVersion
    }
    resetEnvCache()
  })

  it('отдаёт ответ, проходящий контракт HealthResponse', () => {
    const result = service.check()

    expect(HealthResponse.safeParse(result).success).toBe(true)
    expect(result.status).toBe('ok')
    expect(result.service).toBe('api')
    expect(result.version).toBe('1.2.3')
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })

  it('берёт версию из окружения, а не из константы в коде', () => {
    process.env.APP_VERSION = '9.9.9'
    resetEnvCache()

    expect(service.check().version).toBe('9.9.9')
  })

  it('контракт отклоняет посторонний статус', () => {
    expect(HealthResponse.safeParse({ ...service.check(), status: 'down' }).success).toBe(false)
  })
})
