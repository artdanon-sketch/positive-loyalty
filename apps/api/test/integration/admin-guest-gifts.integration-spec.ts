import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Подарок гостю из карточки. docs/02, раздел 5.2.1 · docs/10, раздел 6.11.
 */

const SECRET = 'admin-guest-gifts-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000
const DESSERT = { title: 'Десерт', reason: 'LONG_WAIT', validityDays: 14 }

let app: INestApplication
let prisma: PrismaService
let own: MembershipFixture
let foreign: MembershipFixture
let managerToken: string
let ownerToken: string
let cashierToken: string

interface GiftBody {
  grantId: string
  title: string
  codeTail: string
  expiresAt: string
  replayed: boolean
}

interface ErrorBody {
  error: { code: string; message: string }
}

const server = (): Server => app.getHttpServer() as Server

const sign = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET)

const give = (
  guestId: string,
  body: object,
  token: string = managerToken,
  key: string | null = randomUUID(),
) => {
  const call = request(server())
    .post(`/v1/admin/guests/${guestId}/gifts`)
    .set('Authorization', `Bearer ${token}`)

  return (key === null ? call : call.set('Idempotency-Key', key)).send(body)
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)

  own = await createMembershipFixture(prisma)
  foreign = await createMembershipFixture(prisma)

  managerToken = sign(own.tenantId, 'MANAGER')
  ownerToken = sign(own.tenantId, 'OWNER')
  cashierToken = sign(own.tenantId, 'CASHIER')
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Подарить гостю', () => {
  it('МЕНЕДЖЕР ДАРИТ ДЕСЕРТ — ПОДАРОК В ИСТОРИИ ГОСТЯ И В АУДИТЕ С ПРИЧИНОЙ', async () => {
    const response = await give(own.guestId, DESSERT).expect(201)
    const body = response.body as GiftBody

    expect(body).toMatchObject({ title: 'Десерт', replayed: false })
    expect(body.codeTail).toHaveLength(4)

    // Код целиком — у гостя в приложении, а не в ответе сотруднику.
    const grant = await prisma.offerGrant.findUniqueOrThrow({
      where: { id: body.grantId },
      include: { offer: true },
    })
    expect(JSON.stringify(body)).not.toContain(grant.code)
    expect(grant.state).toBe('ISSUED')
    expect(grant.offer).toMatchObject({
      type: 'GOODWILL',
      visibility: 'VENUE_ONLY',
      status: 'LIVE',
    })

    const card = await request(server())
      .get(`/v1/admin/guests/${own.guestId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200)

    expect((card.body as { timeline: Array<Record<string, unknown>> }).timeline).toContainEqual(
      expect.objectContaining({
        kind: 'GIFT',
        grantId: body.grantId,
        title: 'Десерт',
        state: 'ISSUED',
      }),
    )

    const audit = await prisma.auditLog.findMany({
      where: { action: 'GIFT_ISSUED', entityId: body.grantId },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      tenantId: own.tenantId,
      actorType: 'MANAGER',
      reason: 'Долго ждал',
    })
  })

  it('ПОВТОР С ТЕМ ЖЕ КЛЮЧОМ — ТОТ ЖЕ ПОДАРОК, ВТОРОГО НЕТ', async () => {
    const key = randomUUID()

    const first = (await give(own.guestId, DESSERT, managerToken, key).expect(201)).body as GiftBody
    const second = (await give(own.guestId, DESSERT, managerToken, key).expect(201))
      .body as GiftBody

    expect(second).toMatchObject({ grantId: first.grantId, title: 'Десерт', replayed: true })
    expect(await prisma.offerGrant.count({ where: { nonce: `gift:${own.tenantId}:${key}` } })).toBe(
      1,
    )
    expect(
      await prisma.auditLog.count({ where: { action: 'GIFT_ISSUED', entityId: first.grantId } }),
    ).toBe(1)
  })

  it('тот же ключ для другого гостя — 409, а не чужой подарок', async () => {
    const key = randomUUID()
    const neighbour = await createMembershipFixture(prisma, { tenantId: own.tenantId })

    await give(own.guestId, DESSERT, managerToken, key).expect(201)
    const reused = await give(neighbour.guestId, DESSERT, managerToken, key).expect(409)

    expect((reused.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('без ключа повтора — 400', async () => {
    const response = await give(own.guestId, DESSERT, managerToken, null).expect(400)

    expect((response.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('«другая причина» без комментария — 400 с объяснением', async () => {
    const response = await give(own.guestId, { title: 'Десерт', reason: 'OTHER' }).expect(400)

    expect((response.body as ErrorBody).error.message).toContain('пару слов')
  })

  it('гость соседа — 404, кассиру дарить нельзя — 403', async () => {
    await give(foreign.guestId, DESSERT).expect(404)
    await give(own.guestId, DESSERT, cashierToken).expect(403)
  })

  it('владелец тоже дарит — и в аудите записан как владелец', async () => {
    const response = await give(own.guestId, DESSERT, ownerToken).expect(201)
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'GIFT_ISSUED', entityId: (response.body as GiftBody).grantId },
    })

    expect(audit?.actorType).toBe('OWNER')
  })
})

describe('Лимит менеджера', () => {
  it('МЕНЕДЖЕР УПИРАЕТСЯ В 20 ПОДАРКОВ ЗА СУТКИ, ВЛАДЕЛЕЦ — НЕТ', async () => {
    const busy = await createMembershipFixture(prisma)

    // Двадцать подарков за последние сутки — как будто их уже раздали.
    const offer = await prisma.offer.create({
      data: {
        tenantId: busy.tenantId,
        type: 'GOODWILL',
        status: 'LIVE',
        visibility: 'VENUE_ONLY',
        audience: {},
        schedule: {},
        limits: {},
        reward: {},
        i18n: {},
      },
      select: { id: true },
    })
    await prisma.offerGrant.createMany({
      data: Array.from({ length: 20 }, (_, index) => {
        const code = `LIM${String(index)}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
        return {
          offerId: offer.id,
          tenantId: busy.tenantId,
          guestId: busy.guestId,
          code,
          nonce: `nonce-${code}`,
          expiresAt: new Date(Date.now() + 14 * DAY_MS),
        }
      }),
    })

    const limited = await give(busy.guestId, DESSERT, sign(busy.tenantId, 'MANAGER')).expect(409)
    expect((limited.body as ErrorBody).error.code).toBe('GIFT_LIMIT')

    await give(busy.guestId, DESSERT, sign(busy.tenantId, 'OWNER')).expect(201)
  })
})
