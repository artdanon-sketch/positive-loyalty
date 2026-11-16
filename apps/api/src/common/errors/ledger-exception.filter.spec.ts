import type { Server } from 'node:http'

import { Controller, Get, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BalanceDriftDetectedError,
  InsufficientBalanceError,
  MembershipNotFoundError,
} from '../../core/ledger.errors'

import { LedgerExceptionFilter } from './ledger-exception.filter'

@Controller('probe')
class ProbeController {
  @Get('insufficient')
  insufficient(): never {
    throw new InsufficientBalanceError('m-1', 100, 500)
  }

  @Get('missing')
  missing(): never {
    throw new MembershipNotFoundError('m-2')
  }

  @Get('drift')
  drift(): never {
    throw new BalanceDriftDetectedError('m-3', 10, 20)
  }

  @Get('plain')
  plain(): never {
    throw new Error('не журнал')
  }
}

let app: INestApplication

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile()
  app = moduleRef.createNestApplication({ logger: false })
  app.useGlobalFilters(new LedgerExceptionFilter())
  await app.init()
})

afterAll(async () => {
  await app.close()
})

const get = (path: string) => request(app.getHttpServer() as Server).get(path)

describe('Ошибки журнала баллов отвечают своим кодом, а не голым 500', () => {
  it('НЕХВАТКА БАЛЛОВ — 422 С КОДОМ И ПОНЯТНЫМ ТЕКСТОМ', async () => {
    const response = await get('/probe/insufficient').expect(422)
    expect(response.body).toEqual({
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: expect.stringContaining('Недостаточно баллов'),
      },
    })
  })

  it('ЧУЖОЙ ИЛИ НЕСУЩЕСТВУЮЩИЙ ГОСТЬ — 404', async () => {
    const response = await get('/probe/missing').expect(404)
    expect(response.body.error.code).toBe('MEMBERSHIP_NOT_FOUND')
  })

  it('ВНУТРЕННЯЯ ПОЛОМКА ОСТАЁТСЯ 500, НО БЕЗ ПОДРОБНОСТЕЙ НАРУЖУ', async () => {
    const response = await get('/probe/drift').expect(500)
    expect(response.body.error.code).toBe('BALANCE_DRIFT_DETECTED')
    expect(JSON.stringify(response.body)).not.toContain('m-3')
  })

  it('ЧУЖИЕ ОШИБКИ ФИЛЬТР НЕ ТРОГАЕТ', async () => {
    const response = await get('/probe/plain').expect(500)
    expect(response.body.error).toBeUndefined()
  })
})
