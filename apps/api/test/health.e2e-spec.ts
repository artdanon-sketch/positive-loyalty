import type { Server } from 'node:http'

import { RequestMethod, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { HealthResponse } from '@positive/contracts'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

describe('GET /health (e2e)', () => {
  let app: INestApplication
  let server: Server

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    // Та же схема префиксов, что и в main.ts: health живёт вне /v1.
    app.setGlobalPrefix('v1', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    })

    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => {
    await app.close()
  })

  it('отдаёт 200 и тело, проходящее HealthResponse', async () => {
    const response = await request(server).get('/health').expect(200)
    const body: unknown = response.body

    const parsed = HealthResponse.parse(body)

    expect(parsed.status).toBe('ok')
    expect(parsed.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('несуществующий путь отдаёт 404', async () => {
    await request(server).get('/v1/no-such-endpoint').expect(404)
  })

  it('health не переезжает под префикс версии', async () => {
    await request(server).get('/v1/health').expect(404)
  })
})
