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

describe('Вход из мини-приложения Telegram', () => {
  const path = '/v1/auth/social/telegram/mini-app'

  it('ПОДДЕЛАННАЯ ПОДПИСЬ НЕ ПУСКАЕТ В ЧУЖУЮ КАРТУ', async () => {
    const forged = 'auth_date=1789600000&user=%7B%22id%22%3A42%7D&hash=' + 'a'.repeat(64)

    const response = await request(server()).post(path).send({ initData: forged })

    expect(response.status).toBe(401)
    expect((response.body as { error: { code: string } }).error.code).toBe(
      'TELEGRAM_INIT_DATA_REJECTED',
    )
  })

  it('МУСОР ВМЕСТО ПОДПИСАННЫХ ДАННЫХ — 400, А НЕ 500', async () => {
    expect((await request(server()).post(path).send({ initData: 'нет' })).status).toBe(400)
    expect((await request(server()).post(path).send({})).status).toBe(400)
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

  it('КОШЕЛЁК ПОКАЗЫВАЕТ ПОДАРКИ, НО ТОЛЬКО ЖИВЫЕ И ТОЛЬКО СВОИ', async () => {
    // Ради этого блока и затевалась вся партнёрская механика: гость должен
    // увидеть у себя то, что ему выдали. До сих пор кошелёк про промокоды
    // не знал вовсе, и подарок существовал только в базе.
    const mine = await createMembershipFixture(prisma)
    const stranger = await createMembershipFixture(prisma)

    const makeOffer = async (tenantId: string, title: string): Promise<string> => {
      const offer = await prisma.forTenant(tenantId, async (tx) =>
        tx.offer.create({
          data: {
            tenantId,
            type: 'NETWORK_VOUCHER',
            status: 'LIVE',
            audience: {},
            schedule: {},
            limits: {},
            reward: {},
            visibility: 'PARTNER',
            i18n: { title: { ru: title }, howTo: { ru: ['Покажите код на кассе'] } },
          },
          select: { id: true },
        }),
      )

      return offer.id
    }

    const grant = async (
      tenantId: string,
      guestId: string,
      offerId: string,
      options: { days: number; state?: 'ISSUED' | 'REDEEMED' },
    ): Promise<string> => {
      const code = `W-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

      await prisma.forTenant(tenantId, async (tx) =>
        tx.offerGrant.create({
          data: {
            offerId,
            tenantId,
            guestId,
            code,
            nonce: `nonce-${code}`,
            state: options.state ?? 'ISSUED',
            expiresAt: new Date(Date.now() + options.days * 24 * 60 * 60 * 1000),
          },
        }),
      )

      return code
    }

    const myOffer = await makeOffer(mine.tenantId, 'Ролл в подарок')
    const alienOffer = await makeOffer(stranger.tenantId, 'Чужой подарок')

    const live = await grant(mine.tenantId, mine.guestId, myOffer, { days: 5 })
    const expired = await grant(mine.tenantId, mine.guestId, myOffer, { days: -1 })
    const used = await grant(mine.tenantId, mine.guestId, myOffer, {
      days: 5,
      state: 'REDEEMED',
    })
    const alien = await grant(stranger.tenantId, stranger.guestId, alienOffer, { days: 5 })

    const auth = await loginGuest(mine.guestPhone)

    const wallet = await request(server())
      .get('/v1/guest/wallet')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200)

    const body = wallet.body as {
      vouchers: Array<{
        code: string
        title: string | null
        expiresInDays: number
        howTo: string[]
      }>
    }

    const codes = body.vouchers.map((voucher) => voucher.code)

    expect(codes).toContain(live)
    // Просроченный в списке — обещание, которое не выполнят у стойки.
    expect(codes).not.toContain(expired)
    // Погашенный тоже: кошелёк отвечает «что я могу получить сейчас».
    expect(codes).not.toContain(used)
    // И главное — чужой подарок не виден. Границу держит политика базы.
    expect(codes).not.toContain(alien)

    const shown = body.vouchers.find((voucher) => voucher.code === live)
    expect(shown?.title).toBe('Ролл в подарок')
    expect(shown?.howTo).toEqual(['Покажите код на кассе'])
    // Срок считает сервер: часы телефона можно перевести.
    expect(shown?.expiresInDays).toBe(5)
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

describe('Статус гостя в кошельке', () => {
  it('СТАТУС И СКОЛЬКО ОСТАЛОСЬ ДО СЛЕДУЮЩЕГО — ТЕМ ЖЕ РАСЧЁТОМ, ЧТО У КАССЫ', async () => {
    const venue = await createMembershipFixture(prisma)

    await prisma.tenant.update({
      where: { id: venue.tenantId },
      data: {
        settings: {
          tiers: [
            { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 20 },
            {
              id: 'gold',
              name: 'Золото',
              earnRate: 10,
              redeemRate: 50,
              conditions: [
                { type: 'SPENT_TOTAL', gt: 100_000 },
                { type: 'VISITS_TOTAL', gt: 4 },
              ],
            },
          ],
        },
      },
    })

    await ledger.earn(
      {
        membershipId: venue.membershipId,
        amount: 3_000,
        basisAmount: 60_000,
        idempotencyKey: idempotencyKey('guest-wallet-tier'),
        ...POS_ORIGIN,
      },
      venue.scope,
    )

    const auth = await loginGuest(venue.guestPhone)
    const wallet = await request(server())
      .get('/v1/guest/wallet')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200)

    const body = wallet.body as {
      memberships: Array<{ tenantId: string; tier: unknown; nextTier: unknown }>
    }

    // Оборот 600 ฿ из «больше 1 000 ฿» и один визит из «больше четырёх».
    expect(
      body.memberships.find((membership) => membership.tenantId === venue.tenantId),
    ).toMatchObject({
      tier: { name: 'Гость' },
      nextTier: { name: 'Золото', spentLeft: 40_001, visitsLeft: 4 },
    })
  })
})
