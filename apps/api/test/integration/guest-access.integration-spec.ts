import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, idempotencyKey, POS_ORIGIN } from './ledger-test-context'

/**
 * Гостевой контур целиком: вход по коду → кошелёк → QR → сканирование кассой.
 * docs/02, разделы 1.1–1.2, 2.1–2.2, 3.1.
 *
 * Это и есть финишная проверка Среза 1 в её серверной части: гость получает
 * код, входит, показывает QR, касса находит его и видит баллы.
 */

const SECRET = 'guest-access-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService

const server = (): Server => app.getHttpServer() as Server

interface OtpRequestBody {
  requestId: string
  expiresIn: number
  resendAfter: number
  devCode?: string
}

interface GuestAuthBody {
  accessToken: string
  refreshToken: string
  guest: { id: string; mode: string }
  isNew: boolean
}

/** Свободный диапазон, вне номеров демо-полигона. */
const freshPhone = (): string => `+6693${String(Date.now()).slice(-7)}`

const requestCode = async (phone: string): Promise<OtpRequestBody> => {
  const response = await request(server()).post('/v1/auth/otp/request').send({ phone }).expect(200)
  return response.body as OtpRequestBody
}

const loginGuest = async (phone: string): Promise<GuestAuthBody> => {
  const otp = await requestCode(phone)
  expect(otp.devCode).toBeDefined()

  const verified = await request(server())
    .post('/v1/auth/otp/verify')
    .send({ requestId: otp.requestId, code: otp.devCode })
    .expect(200)

  return verified.body as GuestAuthBody
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
  ledger = moduleRef.get(LedgerService)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Вход по коду', () => {
  it('новый гость: запрос кода → вход → isNew', async () => {
    const auth = await loginGuest(freshPhone())

    expect(auth.isNew).toBe(true)
    expect(auth.guest.mode).toBe('TOURIST')
    expect(auth.accessToken.length).toBeGreaterThan(20)
  })

  it('повторный вход того же телефона не создаёт второго гостя', async () => {
    const phone = freshPhone()
    const first = await loginGuest(phone)
    const second = await loginGuest(phone)

    expect(second.isNew).toBe(false)
    expect(second.guest.id).toBe(first.guest.id)
  })

  it('неверный код: пять попыток и запрос блокируется', async () => {
    const otp = await requestCode(freshPhone())

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server())
        .post('/v1/auth/otp/verify')
        .send({ requestId: otp.requestId, code: '000000' })
        .expect(401)
    }

    // Правильный код после блокировки уже не принимается.
    await request(server())
      .post('/v1/auth/otp/verify')
      .send({ requestId: otp.requestId, code: otp.devCode })
      .expect(401)
  })

  it('четвёртый запрос кода на номер за десять минут отбивается', async () => {
    const phone = freshPhone()
    await requestCode(phone)
    await requestCode(phone)
    await requestCode(phone)

    const refused = await request(server()).post('/v1/auth/otp/request').send({ phone }).expect(400)

    expect(JSON.stringify(refused.body)).toMatch(/RATE_LIMITED/)
  })

  it('SMS-канал честно отвечает, что провайдера ещё нет', async () => {
    const refused = await request(server())
      .post('/v1/auth/otp/request')
      .send({ phone: freshPhone(), channel: 'SMS' })
      .expect(400)

    expect(JSON.stringify(refused.body)).toMatch(/CHANNEL_UNAVAILABLE/)
  })
})

describe('Гостевое API', () => {
  it('профиль отдаёт маскированный телефон', async () => {
    const phone = freshPhone()
    const auth = await loginGuest(phone)

    const me = await request(server())
      .get('/v1/guest/me')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200)

    const body = me.body as { phoneMasked: string }
    expect(body.phoneMasked).toBe(`${phone.slice(0, 3)} •• •• ${phone.slice(-4)}`)
    expect(JSON.stringify(me.body)).not.toContain(phone)
  })

  it('кошелёк собирает участия во всех заведениях гостя', async () => {
    // Гость с участиями в двух заведениях и баллами в одном.
    const first = await createMembershipFixture(prisma)
    const second = await createMembershipFixture(prisma)
    const moved = await prisma.membership.update({
      where: { id: second.membershipId },
      data: { guestId: first.guestId },
      select: { id: true },
    })

    await ledger.earn(
      {
        membershipId: first.membershipId,
        amount: 12_000,
        basisAmount: 240_000,
        idempotencyKey: idempotencyKey('guest-wallet'),
        ...POS_ORIGIN,
      },
      first.scope,
    )

    const auth = await loginGuest(first.guestPhone)
    expect(auth.isNew).toBe(false)

    const wallet = await request(server())
      .get('/v1/guest/wallet')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200)

    const body = wallet.body as {
      totalPoints: number
      memberships: Array<{ tenantId: string; points: number }>
    }

    expect(body.totalPoints).toBe(12_000)
    expect(body.memberships).toHaveLength(2)
    expect(body.memberships.some((m) => m.points === 12_000)).toBe(true)
    // Ссылка на перенесённое участие цела — кошелёк видит оба заведения.
    expect(moved.id).toBe(second.membershipId)
  })

  it('staff-токен в гостевое API не проходит, гостевой — в бэк-офис', async () => {
    const fixture = await createMembershipFixture(prisma)
    const staffToken = signAccessToken(
      { tenantId: fixture.tenantId, actorId: null, role: 'OWNER' },
      SECRET,
    )

    await request(server())
      .get('/v1/guest/wallet')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(401)

    const guestAuth = await loginGuest(freshPhone())
    await request(server())
      .get('/v1/admin/ledger')
      .set('Authorization', `Bearer ${guestAuth.accessToken}`)
      .expect(401)
  })
})

describe('QR на кассе', () => {
  it('касса находит гостя по токену с экрана и оформляет участие', async () => {
    const venue = await createMembershipFixture(prisma)
    const cashier = signAccessToken(
      { tenantId: venue.tenantId, actorId: null, role: 'CASHIER' },
      SECRET,
    )

    const guestAuth = await loginGuest(freshPhone())

    const qr = await request(server())
      .get('/v1/guest/qr-token')
      .set('Authorization', `Bearer ${guestAuth.accessToken}`)
      .expect(200)

    const token = (qr.body as { token: string }).token

    const found = await request(server())
      .get(`/v1/pos/guest?token=${encodeURIComponent(token)}`)
      .set('Authorization', `Bearer ${cashier}`)
      .expect(200)

    const body = found.body as { guestId: string; membershipId: string; isNew: boolean }
    expect(body.guestId).toBe(guestAuth.guest.id)
    expect(body.isNew).toBe(true)

    // Участие реально создано в заведении кассира.
    const membership = await prisma.forTenant(venue.tenantId, async (tx) =>
      tx.membership.findFirst({ where: { id: body.membershipId, tenantId: venue.tenantId } }),
    )
    expect(membership).not.toBeNull()

    // Повторное сканирование не плодит участий.
    const again = await request(server())
      .get(`/v1/pos/guest?token=${encodeURIComponent(token)}`)
      .set('Authorization', `Bearer ${cashier}`)
      .expect(200)
    expect((again.body as { membershipId: string }).membershipId).toBe(body.membershipId)
  })

  it('access-токен гостя кассой не принимается — только QR-вид', async () => {
    const venue = await createMembershipFixture(prisma)
    const cashier = signAccessToken(
      { tenantId: venue.tenantId, actorId: null, role: 'CASHIER' },
      SECRET,
    )
    const guestAuth = await loginGuest(freshPhone())

    await request(server())
      .get(`/v1/pos/guest?token=${encodeURIComponent(guestAuth.accessToken)}`)
      .set('Authorization', `Bearer ${cashier}`)
      .expect(404)
  })
})

describe('Ротация гостевого refresh', () => {
  it('повтор отозванного гасит всю цепочку', async () => {
    const auth = await loginGuest(freshPhone())

    const rotated = await request(server())
      .post('/v1/auth/otp/refresh')
      .send({ refreshToken: auth.refreshToken })
      .expect(200)
    const second = (rotated.body as GuestAuthBody).refreshToken

    await request(server())
      .post('/v1/auth/otp/refresh')
      .send({ refreshToken: auth.refreshToken })
      .expect(401)

    await request(server()).post('/v1/auth/otp/refresh').send({ refreshToken: second }).expect(401)
  })
})
