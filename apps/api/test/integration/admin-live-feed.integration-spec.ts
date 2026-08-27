import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerEventsService, maskName } from '../../src/core/ledger-events.service'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, idempotencyKey, POS_ORIGIN } from './ledger-test-context'

/**
 * Живая лента начислений. docs/03, раздел 2.
 *
 * Проверяется то, что дороже всего сломать незаметно: изоляция заведений
 * и маскирование имени. Лента висит на экране в зале — чужой чек или полное
 * имя гостя на нём видит любой прохожий.
 */

const SECRET = 'admin-live-feed-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let events: LedgerEventsService

const server = (): Server => app.getHttpServer() as Server

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)
  events = moduleRef.get(LedgerEventsService)
}, 60_000)

afterAll(async () => {
  await app.close()
})

/** Ждёт одно событие подписки либо сдаётся: тест не должен висеть вечно. */
const nextEvent = async (tenantId: string, timeoutMs = 5_000): Promise<unknown> =>
  new Promise((resolve) => {
    const stop = events.subscribe(tenantId, (event) => {
      stop()
      clearTimeout(timer)
      resolve(event)
    })

    const timer = setTimeout(() => {
      stop()
      resolve(null)
    }, timeoutMs)
  })

describe('Маскирование имени', () => {
  it('оставляет только первую букву', () => {
    expect(maskName('Анна')).toBe('А***')
    expect(maskName('  Somchai  ')).toBe('S***')
  })

  it('безымянный гость не превращается в звёздочки', () => {
    // Пустая маска отличима от имени: «***» выглядело бы как скрытое имя,
    // которого на самом деле нет.
    expect(maskName(null)).toBe('')
    expect(maskName('   ')).toBe('')
  })
})

describe('Поток начислений', () => {
  it('доносит начисление своего заведения', async () => {
    const fixture = await createMembershipFixture(prisma)
    await prisma.guest.update({
      where: { id: fixture.guestId },
      data: { displayName: 'Анна Ковалёва' },
    })

    const received = nextEvent(fixture.tenantId)

    await ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 6_250,
        basisAmount: 125_000,
        idempotencyKey: idempotencyKey('feed-own'),
        refType: 'receipt',
        refId: 'feed-own-1',
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    const event = (await received) as { masked: string; amount: number; basis: number } | null

    expect(event).not.toBeNull()
    // Имя маскируется НА СЕРВЕРЕ: полное имя не должно доехать до браузера.
    expect(event?.masked).toBe('А***')
    expect(JSON.stringify(event)).not.toContain('Ковалёва')
    expect(event?.amount).toBe(6_250)
    expect(event?.basis).toBe(125_000)
  })

  it('чужое начисление на чужой экран не попадает', async () => {
    const own = await createMembershipFixture(prisma)
    const foreign = await createMembershipFixture(prisma)

    // Слушаем СВОЁ заведение, а начисляем в чужом.
    const received = nextEvent(own.tenantId, 1_500)

    await ledger.earn(
      {
        membershipId: foreign.membershipId,
        amount: 1_000,
        basisAmount: 20_000,
        idempotencyKey: idempotencyKey('feed-foreign'),
        refType: 'receipt',
        refId: 'feed-foreign-1',
        ...POS_ORIGIN,
      },
      foreign.scope,
    )

    expect(await received).toBeNull()
  })

  it('повтор чека не показывается лентой второй раз', async () => {
    const fixture = await createMembershipFixture(prisma)
    const key = idempotencyKey('feed-replay')

    const input = {
      membershipId: fixture.membershipId,
      amount: 500,
      basisAmount: 10_000,
      idempotencyKey: key,
      refType: 'receipt' as const,
      refId: 'feed-replay-1',
      ...POS_ORIGIN,
    }

    const first = nextEvent(fixture.tenantId)
    await ledger.earn(input, fixture.scope)
    expect(await first).not.toBeNull()

    // Тот же ключ: сервер вернёт первый ответ, новой операции не возникнет.
    const second = nextEvent(fixture.tenantId, 1_500)
    await ledger.earn(input, fixture.scope)

    // Повтор — не событие. Одна продажа не должна появиться на экране дважды.
    expect(await second).toBeNull()
  })

  it('операция не от чека лентой не показывается', async () => {
    const fixture = await createMembershipFixture(prisma)
    const received = nextEvent(fixture.tenantId, 1_500)

    // Ручная правка баланса без чека: объяснить её на экране в зале некому.
    await ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('feed-no-receipt'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(await received).toBeNull()
  })
})

describe('Доступ к потоку', () => {
  it('кассиру лента закрыта', async () => {
    const fixture = await createMembershipFixture(prisma)
    const token = signAccessToken(
      { tenantId: fixture.tenantId, actorId: null, role: 'CASHIER' },
      SECRET,
    )

    // Матрица прав docs/05, раздел 3: аналитика точки — менеджер и владелец.
    await request(server())
      .get('/v1/admin/stream')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
  })

  it('без токена лента закрыта', async () => {
    await request(server()).get('/v1/admin/stream').expect(401)
  })
})
