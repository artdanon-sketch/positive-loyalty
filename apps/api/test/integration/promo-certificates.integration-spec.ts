import type { Server } from 'node:http'

import { NotFoundException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { TenantContext } from '../../src/common/tenant/tenant-context'
import { OfferGrantService } from '../../src/core/offer-grant.service'
import { PrismaService } from '../../src/core/prisma.service'
import { GuestPromoService } from '../../src/identity/guest-promo.service'

import {
  createLedgerTestContext,
  createMembershipFixture,
  createTenant,
} from './ledger-test-context'
import type { LedgerTestContext, MembershipFixture } from './ledger-test-context'

/**
 * Промо-сертификаты: гость забирает сертификат сам. docs/02, раздел 5.11.
 *
 * Полигон: наше заведение с гостем и соседнее со своим гостем. Владелец делает
 * шаблон промо-сертификатом; проверяем, что гость его видит и берёт, повтор
 * возвращает тот же код, а чужой/не-промо/выключенный — не берётся.
 */

const SECRET = 'promo-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let guest: MembershipFixture
let neighbour: MembershipFixture
let ownerToken: string
let neighbourOwnerToken: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`
const guestBearer = (guestId: string): string => bearer(signGuestToken({ guestId }, SECRET))

interface Template {
  id: string
  selfClaim: boolean
  issued: number
  redeemed: number
}

interface PromoItem {
  offerId: string
  venue: string
  title: string
  validityDays: number
  claimed: boolean
}

interface Claimed {
  offerId: string
  code: string
  expiresAt: string
}

const createTemplate = async (
  token: string,
  title: string,
  selfClaim: boolean,
): Promise<Template> =>
  (
    await request(server())
      .post('/v1/admin/certificates')
      .set('Authorization', bearer(token))
      .send({ title, value: { kind: 'FIXED_OFF', amount: 50_000 }, validityDays: 30, selfClaim })
  ).body as Template

const listPromo = (guestId: string) =>
  request(server()).get('/v1/guest/promo').set('Authorization', guestBearer(guestId))

const firstPromo = async (guestId: string): Promise<PromoItem> => {
  const items = (await listPromo(guestId)).body as PromoItem[]
  const promo = items[0]
  if (promo === undefined) {
    throw new Error('на витрине нет промо-сертификата')
  }
  return promo
}

const claim = (guestId: string, offerId: string) =>
  request(server())
    .post(`/v1/guest/promo/${offerId}/claim`)
    .set('Authorization', guestBearer(guestId))

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)

  tenantId = await createTenant(prisma)
  guest = await createMembershipFixture(prisma, { tenantId })
  neighbour = await createMembershipFixture(prisma)

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  neighbourOwnerToken = signAccessToken(
    { tenantId: neighbour.tenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
})

afterAll(async () => {
  await app.close()
})

describe('Промо-сертификаты: гость забирает сам', () => {
  it('ВИТРИНА ПОКАЗЫВАЕТ ТОЛЬКО ПРОМО СВОЕГО ЗАВЕДЕНИЯ', async () => {
    const promo = await createTemplate(ownerToken, 'Промо на 500 ฿', true)
    // Обычный (не-промо) шаблон того же заведения на витрину не попадает.
    await createTemplate(ownerToken, 'Обычный сертификат', false)
    // Чужое промо соседа нашему гостю не видно.
    await createTemplate(neighbourOwnerToken, 'Чужое промо', true)

    const listed = await listPromo(guest.guestId)
    expect(listed.status).toBe(200)
    const items = listed.body as PromoItem[]

    expect(items.map((item) => item.offerId)).toEqual([promo.id])
    expect(items[0]).toMatchObject({ title: 'Промо на 500 ฿', claimed: false, validityDays: 30 })
  })

  it('ГОСТЬ ЗАБИРАЕТ ПРОМО: КОД ПОПАДАЕТ В КОШЕЛЁК, СЧЁТЧИК РАСТЁТ, ВИТРИНА ГАСНЕТ', async () => {
    const promo = await firstPromo(guest.guestId)

    const before = Date.now()
    const taken = await claim(guest.guestId, promo.offerId)
    expect(taken.status).toBe(201)
    const body = taken.body as Claimed
    expect(body.offerId).toBe(promo.offerId)
    expect(body.code.length).toBeGreaterThanOrEqual(8)

    const days = (new Date(body.expiresAt).getTime() - before) / (24 * 60 * 60 * 1000)
    expect(Math.round(days)).toBe(30)

    // Код виден в кошельке гостя.
    const wallet = await request(server())
      .get('/v1/guest/wallet')
      .set('Authorization', guestBearer(guest.guestId))
    expect(JSON.stringify(wallet.body)).toContain(body.code)

    // Счётчик «выдано» у шаблона вырос.
    const templates = (
      await request(server()).get('/v1/admin/certificates').set('Authorization', bearer(ownerToken))
    ).body as Template[]
    expect(templates.find((row) => row.id === promo.offerId)).toMatchObject({ issued: 1 })

    // На витрине промо теперь помечено забранным.
    const after = (await listPromo(guest.guestId)).body as PromoItem[]
    expect(after.find((item) => item.offerId === promo.offerId)?.claimed).toBe(true)
  })

  it('ПОВТОРНОЕ «ЗАБРАТЬ» ВОЗВРАЩАЕТ ТОТ ЖЕ КОД, ВТОРОГО НЕ ВЫДАЁТ', async () => {
    const promo = await firstPromo(guest.guestId)

    const first = await claim(guest.guestId, promo.offerId)
    const second = await claim(guest.guestId, promo.offerId)

    // Статус — первым делом. Без него два ответа 500 давали «undefined ===
    // undefined», и тест был зелёным, пока повтор отвечал ошибкой.
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect((second.body as Claimed).code).toBe((first.body as Claimed).code)
    expect((first.body as Claimed).code.length).toBeGreaterThan(0)

    const templates = (
      await request(server()).get('/v1/admin/certificates').set('Authorization', bearer(ownerToken))
    ).body as Template[]
    // По-прежнему один — повтор кода не удвоил выдачу.
    expect(templates.find((row) => row.id === promo.offerId)).toMatchObject({ issued: 1 })
  })

  it('НЕ-ПРОМО ШАБЛОН НЕ ЗАБРАТЬ — 404', async () => {
    const plain = await createTemplate(ownerToken, 'Только из карточки', false)

    const taken = await claim(guest.guestId, plain.id)
    expect(taken.status).toBe(404)
  })

  it('ЧУЖОЕ ПРОМО НЕ ЗАБРАТЬ — 404 (кросс-тенант)', async () => {
    const foreign = await createTemplate(neighbourOwnerToken, 'Соседское промо', true)

    const taken = await claim(guest.guestId, foreign.id)
    expect(taken.status).toBe(404)

    // И на витрине нашего гостя его нет.
    const items = (await listPromo(guest.guestId)).body as PromoItem[]
    expect(items.map((item) => item.offerId)).not.toContain(foreign.id)
  })

  it('ВЫКЛЮЧЕННОЕ ПРОМО ИСЧЕЗАЕТ С ВИТРИНЫ И НЕ ЗАБИРАЕТСЯ', async () => {
    const promo = await createTemplate(ownerToken, 'Временное промо', true)

    // Видно до выключения.
    expect(
      ((await listPromo(guest.guestId)).body as PromoItem[]).map((item) => item.offerId),
    ).toContain(promo.id)

    await request(server())
      .patch(`/v1/admin/certificates/${promo.id}`)
      .set('Authorization', bearer(ownerToken))
      .send({ isActive: false })

    // Пропало с витрины и не берётся.
    expect(
      ((await listPromo(guest.guestId)).body as PromoItem[]).map((item) => item.offerId),
    ).not.toContain(promo.id)
    expect((await claim(guest.guestId, promo.id)).status).toBe(404)
  })
})

/** Настоящий PrismaService под ролью приложения — приём из ledger-app-role. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      'Не задан DATABASE_URL_TEST_APP_ROLE — политику guest_promo_offers не проверить.',
    )
  }

  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = url

  try {
    return await createLedgerTestContext()
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL']
    } else {
      process.env['DATABASE_URL'] = previous
    }
  }
}

describe('Промо-сертификаты под ролью приложения, как на бою', () => {
  // Тесты выше ходят суперпользователем, а для него политики RLS не действуют:
  // зелёными они были бы и без guest_promo_offers. На бою API ходит ролью
  // positive_app — здесь под ней работает тот же код сервиса, что отвечает гостю.
  let appRole: LedgerTestContext
  let service: GuestPromoService

  const asGuest = async <T>(guestId: string, run: () => Promise<T>): Promise<T> =>
    TenantContext.run(
      { tenantId: '', actorId: null, role: null, guestId, requestId: 'promo-app-role' },
      run,
    )

  beforeAll(async () => {
    appRole = await createAppRoleContext()
    service = new GuestPromoService(appRole.prisma, new OfferGrantService(appRole.prisma))
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('ГОСТЬ ВИДИТ И ЗАБИРАЕТ ПРОМО СВОЕГО ЗАВЕДЕНИЯ; СОСЕДСКОЕ И НЕ-ПРОМО ЕМУ НЕ ВИДНЫ', async () => {
    const promo = await createTemplate(ownerToken, 'Промо под ролью приложения', true)
    const plain = await createTemplate(ownerToken, 'Обычный под ролью приложения', false)
    const foreign = await createTemplate(
      neighbourOwnerToken,
      'Соседское под ролью приложения',
      true,
    )

    const seen = (await asGuest(guest.guestId, () => service.list())).map((item) => item.offerId)
    expect(seen).toContain(promo.id)
    expect(seen).not.toContain(plain.id)
    expect(seen).not.toContain(foreign.id)

    const claimed = await asGuest(guest.guestId, () => service.claim(promo.id))
    expect(claimed.offerId).toBe(promo.id)
    expect(claimed.code.length).toBeGreaterThan(0)

    // Гость соседнего заведения нашего промо не видит и забрать не может.
    const theirs = (await asGuest(neighbour.guestId, () => service.list())).map(
      (item) => item.offerId,
    )
    expect(theirs).not.toContain(promo.id)
    await expect(asGuest(neighbour.guestId, () => service.claim(promo.id))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
