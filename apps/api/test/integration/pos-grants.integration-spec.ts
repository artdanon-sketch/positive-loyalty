import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'

/**
 * Промокод POSitive в кошельке гостя: POST /v1/pos/grants и /grants/:code/void.
 *
 * Главное, что здесь закреплено: один и тот же код живёт в двух заведениях
 * (промокод аккаунта POSitive на Кефир и ThaiNuki), и погашение в одном не
 * трогает строку другого.
 */

interface IssueBody {
  grantId: string
  code: string
  expiresAt: string
  replayed: boolean
}

interface ErrorBody {
  error: { code: string }
}

const errorCode = (res: { body: unknown }): string => (res.body as ErrorBody).error.code

const SECRET = 'pos-grants-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService

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
})

afterAll(async () => {
  await app.close()
})

const venue = async () => {
  const tenantId = await createTenant(prisma)
  const link = signAccessToken({ tenantId, actorId: null, role: 'POS_LINK' }, SECRET, 3600)
  return { tenantId, link }
}

const uniqueCode = (): string =>
  `IRA${String(Date.now()).slice(-6)}${String(Math.random()).slice(2, 5)}`

const body = (phone: string, code: string, extra: object = {}) => ({
  phone,
  code,
  title: '−20% на заказ',
  howTo: ['Кефир и ThaiNuki', 'от ฿500'],
  expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
  ...extra,
})

const issue = (token: string, payload: object, key: string | null = randomUUID()) => {
  const call = request(server()).post('/v1/pos/grants').set('Authorization', `Bearer ${token}`)
  return (key === null ? call : call.set('Idempotency-Key', key)).send(payload)
}

const redeem = (token: string, code: string, receiptId = `r-${randomUUID()}`) =>
  request(server())
    .post('/v1/pos/grants/redeem')
    .set('Authorization', `Bearer ${token}`)
    .send({ code, receiptId })

const voidGrant = (token: string, code: string) =>
  request(server())
    .post(`/v1/pos/grants/${code}/void`)
    .set('Authorization', `Bearer ${token}`)
    .send({})

describe('Промокод POSitive: выдача в кошелёк', () => {
  it('кладёт гостю код, который ему прислали, с точным сроком и названием', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()
    const expiresAt = new Date(Date.now() + 10 * DAY_MS)
    expiresAt.setMilliseconds(0)

    const res = await issue(
      link,
      body(guest.guestPhone, code.toLowerCase(), { expiresAt: expiresAt.toISOString() }),
    ).expect(201)

    expect(res.body).toMatchObject({ code, replayed: false })
    expect((res.body as IssueBody).expiresAt).toBe(expiresAt.toISOString())

    const row = await prisma.offerGrant.findFirstOrThrow({
      where: { tenantId, code },
      select: { guestId: true, state: true, offer: { select: { type: true, i18n: true } } },
    })
    expect(row.guestId).toBe(guest.guestId)
    expect(row.state).toBe('ISSUED')
    expect(row.offer.type).toBe('GOODWILL')
    expect(row.offer.i18n).toMatchObject({ title: { ru: '−20% на заказ' } })

    const audit = await prisma.auditLog.count({
      where: {
        tenantId,
        action: 'GIFT_ISSUED',
        entityId: (res.body as { grantId: string }).grantId,
      },
    })
    expect(audit).toBe(1)
  })

  it('один код — в двух заведениях; погашение в одном не трогает другое', async () => {
    const kefir = await venue()
    const thai = await venue()
    const guestK = await createMembershipFixture(prisma, { tenantId: kefir.tenantId })
    const code = uniqueCode()

    // Тот же гость — участник обоих заведений.
    await prisma.membership.create({
      data: { tenantId: thai.tenantId, guestId: guestK.guestId },
    })

    await issue(kefir.link, body(guestK.guestPhone, code)).expect(201)
    await issue(thai.link, body(guestK.guestPhone, code)).expect(201)

    await redeem(kefir.link, code).expect(200)

    const states = await prisma.offerGrant.findMany({
      where: { code },
      select: { tenantId: true, state: true },
    })
    expect(states).toHaveLength(2)
    expect(states.find((s) => s.tenantId === kefir.tenantId)?.state).toBe('REDEEMED')
    expect(states.find((s) => s.tenantId === thai.tenantId)?.state).toBe('ISSUED')

    await redeem(thai.link, code).expect(200)
  })

  it('повтор с тем же ключом — первый ответ, вторая строка не появляется', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()
    const key = randomUUID()

    const first = await issue(link, body(guest.guestPhone, code), key).expect(201)
    const again = await issue(link, body(guest.guestPhone, code), key).expect(201)

    expect(again.body).toMatchObject({ grantId: (first.body as IssueBody).grantId, replayed: true })
    expect(await prisma.offerGrant.count({ where: { tenantId, code } })).toBe(1)
  })

  it('тот же ключ с другим кодом — 409, а не тихая подмена', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const key = randomUUID()

    await issue(link, body(guest.guestPhone, uniqueCode()), key).expect(201)
    const res = await issue(link, body(guest.guestPhone, uniqueCode()), key).expect(409)

    expect(errorCode(res)).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('код уже занят в заведении — 409 CODE_TAKEN, пустая акция закрыта', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await issue(link, body(guest.guestPhone, code)).expect(201)
    const res = await issue(link, body(guest.guestPhone, code)).expect(409)

    expect(errorCode(res)).toBe('CODE_TAKEN')
    expect(
      await prisma.offer.count({ where: { tenantId, type: 'GOODWILL', status: 'LIVE' } }),
    ).toBe(1)
  })

  it('телефон не участника — 404, гостя не заводим', async () => {
    const { tenantId, link } = await venue()
    const stranger = await createMembershipFixture(prisma)

    const res = await issue(link, body(stranger.guestPhone, uniqueCode())).expect(404)

    expect(errorCode(res)).toBe('GUEST_NOT_FOUND')
    expect(await prisma.membership.count({ where: { tenantId } })).toBe(0)
    expect(await prisma.offer.count({ where: { tenantId } })).toBe(0)
  })

  it('без ключа, с прошедшим сроком, с кривым кодом — 400', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })

    await issue(link, body(guest.guestPhone, uniqueCode()), null).expect(400)
    await issue(
      link,
      body(guest.guestPhone, uniqueCode(), {
        expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
      }),
    ).expect(400)
    await issue(link, body(guest.guestPhone, 'ИРА-20')).expect(400)
    await issue(link, { ...body(guest.guestPhone, uniqueCode()), extra: 1 }).expect(400)
  })

  it('кассиру и менеджеру выдавать нельзя — 403', async () => {
    const { tenantId } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })

    for (const role of ['CASHIER', 'MANAGER']) {
      const token = signAccessToken({ tenantId, actorId: null, role }, SECRET, 3600)
      await issue(token, body(guest.guestPhone, uniqueCode())).expect(403)
    }
  })
})

describe('Промокод POSitive: аннулирование', () => {
  it('снимает невостребованный код, повтор безопасен, погасить после нельзя', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await issue(link, body(guest.guestPhone, code)).expect(201)

    const first = await voidGrant(link, code.toLowerCase()).expect(200)
    expect(first.body).toEqual({ code, voided: true, state: 'VOID' })

    const again = await voidGrant(link, code).expect(200)
    expect(again.body).toEqual({ code, voided: false, state: 'VOID' })

    const res = await redeem(link, code).expect(400)
    expect(errorCode(res)).toBe('GRANT_ALREADY_USED')
  })

  it('погашенный не трогает', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await issue(link, body(guest.guestPhone, code)).expect(201)
    await redeem(link, code).expect(200)

    const res = await voidGrant(link, code).expect(200)
    expect(res.body).toEqual({ code, voided: false, state: 'REDEEMED' })
  })

  it('чужое заведение кода не видит — 404, строка соседа цела', async () => {
    const own = await venue()
    const foreign = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId: own.tenantId })
    const code = uniqueCode()

    await issue(own.link, body(guest.guestPhone, code)).expect(201)
    await voidGrant(foreign.link, code).expect(404)

    const row = await prisma.offerGrant.findFirstOrThrow({
      where: { tenantId: own.tenantId, code },
      select: { state: true },
    })
    expect(row.state).toBe('ISSUED')
  })
})
