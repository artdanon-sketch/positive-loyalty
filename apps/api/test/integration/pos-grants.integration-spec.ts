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
 * Промокод POSitive в кошельке гостя: PUT /v1/pos/grants/:code и /grants/:code/void.
 *
 * Главное, что здесь закреплено: один и тот же код живёт в двух заведениях
 * (промокод аккаунта POSitive на Кефир и ThaiNuki), погашение в одном не трогает
 * строку другого, а строка-зеркало переживает правки промокода в POSitive.
 */

interface PutBody {
  grantId: string
  code: string
  expiresAt: string
  created: boolean
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

const later = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString()

const body = (phone: string, extra: object = {}) => ({
  phone,
  title: '−20% на заказ',
  howTo: ['Кефир и ThaiNuki', 'от ฿500'],
  expiresAt: later(30),
  ...extra,
})

const put = (token: string, code: string, payload: object) =>
  request(server())
    .put(`/v1/pos/grants/${code}`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload)

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

const grantOf = (tenantId: string, code: string) =>
  prisma.offerGrant.findFirstOrThrow({
    where: { tenantId, code },
    select: {
      guestId: true,
      state: true,
      expiresAt: true,
      offer: { select: { type: true, status: true, i18n: true } },
    },
  })

describe('Промокод POSitive: положить в кошелёк', () => {
  it('кладёт гостю код, который ему прислали, с точным сроком и названием', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()
    const expiresAt = new Date(Date.now() + 10 * DAY_MS)
    expiresAt.setMilliseconds(0)

    const res = await put(
      link,
      code.toLowerCase(),
      body(guest.guestPhone, { expiresAt: expiresAt.toISOString() }),
    ).expect(200)

    expect(res.body).toMatchObject({ code, created: true, expiresAt: expiresAt.toISOString() })

    const row = await grantOf(tenantId, code)
    expect(row.guestId).toBe(guest.guestId)
    expect(row.state).toBe('ISSUED')
    expect(row.offer.type).toBe('GOODWILL')
    expect(row.offer.i18n).toMatchObject({ title: { ru: '−20% на заказ' } })

    const audit = await prisma.auditLog.count({
      where: { tenantId, action: 'GIFT_ISSUED', entityId: (res.body as PutBody).grantId },
    })
    expect(audit).toBe(1)
  })

  it('один код — в двух заведениях; погашение в одном не трогает другое', async () => {
    const kefir = await venue()
    const thai = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId: kefir.tenantId })
    const code = uniqueCode()

    // Тот же гость — участник обоих заведений.
    await prisma.membership.create({ data: { tenantId: thai.tenantId, guestId: guest.guestId } })

    await put(kefir.link, code, body(guest.guestPhone)).expect(200)
    await put(thai.link, code, body(guest.guestPhone)).expect(200)

    await redeem(kefir.link, code).expect(200)

    expect((await grantOf(kefir.tenantId, code)).state).toBe('REDEEMED')
    expect((await grantOf(thai.tenantId, code)).state).toBe('ISSUED')

    await redeem(thai.link, code).expect(200)
  })

  it('повторный PUT обновляет срок и название, вторая строка не появляется', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    const first = await put(link, code, body(guest.guestPhone)).expect(200)
    const again = await put(
      link,
      code,
      body(guest.guestPhone, { title: '−25% на заказ', expiresAt: later(60) }),
    ).expect(200)

    expect(again.body).toMatchObject({ grantId: (first.body as PutBody).grantId, created: false })
    expect(await prisma.offerGrant.count({ where: { tenantId, code } })).toBe(1)

    const row = await grantOf(tenantId, code)
    expect(row.offer.i18n).toMatchObject({ title: { ru: '−25% на заказ' } })
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * DAY_MS)
  })

  it('снятый код возвращается в кошелёк — уже другому гостю, если сменили получателя', async () => {
    const { tenantId, link } = await venue()
    const ira = await createMembershipFixture(prisma, { tenantId })
    const masha = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await put(link, code, body(ira.guestPhone)).expect(200)
    await voidGrant(link, code).expect(200)
    await put(link, code, body(masha.guestPhone)).expect(200)

    const row = await grantOf(tenantId, code)
    expect(row.state).toBe('ISSUED')
    expect(row.guestId).toBe(masha.guestId)
    expect(row.offer.status).toBe('LIVE')
  })

  it('погашенный код не воскрешает — 409', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await put(link, code, body(guest.guestPhone)).expect(200)
    await redeem(link, code).expect(200)
    const res = await put(link, code, body(guest.guestPhone, { expiresAt: later(90) })).expect(409)

    expect(errorCode(res)).toBe('GRANT_ALREADY_USED')
    expect((await grantOf(tenantId, code)).state).toBe('REDEEMED')
  })

  it('код подарка самого Loyalty не перезаписывает и не снимает', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const offer = await prisma.offer.create({
      data: {
        tenantId,
        type: 'GOODWILL',
        status: 'LIVE',
        visibility: 'VENUE_ONLY',
        audience: {},
        schedule: {},
        limits: {},
        reward: { kind: 'FREE_ITEM', itemName: 'Десерт', minCheck: 0 },
        i18n: { title: { ru: 'Десерт' } },
      },
    })
    const native = await prisma.offerGrant.create({
      data: {
        offerId: offer.id,
        tenantId,
        guestId: guest.guestId,
        code: uniqueCode(),
        nonce: `gift:${tenantId}:${randomUUID()}`,
        expiresAt: new Date(later(7)),
      },
    })

    const res = await put(link, native.code, body(guest.guestPhone)).expect(409)
    expect(errorCode(res)).toBe('CODE_TAKEN')
    await voidGrant(link, native.code).expect(404)
    expect((await grantOf(tenantId, native.code)).state).toBe('ISSUED')
  })

  it('телефон не участника — 404, гостя не заводим', async () => {
    const { tenantId, link } = await venue()
    const stranger = await createMembershipFixture(prisma)

    const res = await put(link, uniqueCode(), body(stranger.guestPhone)).expect(404)

    expect(errorCode(res)).toBe('GUEST_NOT_FOUND')
    expect(await prisma.membership.count({ where: { tenantId } })).toBe(0)
    expect(await prisma.offer.count({ where: { tenantId } })).toBe(0)
  })

  it('прошедший срок, кривой код, лишнее поле — 400', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })

    await put(link, uniqueCode(), body(guest.guestPhone, { expiresAt: later(-1) })).expect(400)
    await put(link, encodeURIComponent('ИРА20'), body(guest.guestPhone)).expect(400)
    await put(link, uniqueCode(), { ...body(guest.guestPhone), extra: 1 }).expect(400)
  })

  it('кассиру и менеджеру нельзя — 403', async () => {
    const { tenantId } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })

    for (const role of ['CASHIER', 'MANAGER']) {
      const token = signAccessToken({ tenantId, actorId: null, role }, SECRET, 3600)
      await put(token, uniqueCode(), body(guest.guestPhone)).expect(403)
      await voidGrant(token, uniqueCode()).expect(403)
    }
  })
})

describe('Промокод POSitive: снять из кошелька', () => {
  it('снимает невостребованный код, повтор безопасен, погасить после нельзя', async () => {
    const { tenantId, link } = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId })
    const code = uniqueCode()

    await put(link, code, body(guest.guestPhone)).expect(200)

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

    await put(link, code, body(guest.guestPhone)).expect(200)
    await redeem(link, code).expect(200)

    const res = await voidGrant(link, code).expect(200)
    expect(res.body).toEqual({ code, voided: false, state: 'REDEEMED' })
  })

  it('чужое заведение кода не видит — 404, строка соседа цела', async () => {
    const own = await venue()
    const foreign = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId: own.tenantId })
    const code = uniqueCode()

    await put(own.link, code, body(guest.guestPhone)).expect(200)
    await voidGrant(foreign.link, code).expect(404)

    expect((await grantOf(own.tenantId, code)).state).toBe('ISSUED')
  })
})
