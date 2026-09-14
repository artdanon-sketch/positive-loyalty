import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  createTenant,
  idempotencyKey,
  POS_ORIGIN,
} from './ledger-test-context'

/**
 * Список акций заведения. docs/02, раздел 5.3 · docs/10, раздел 5.3.
 *
 * Полигон: у ресторана партнёрская акция студии (идёт), своя завершённая,
 * запланированная и подарок из карточки гостя. У партнёрской четыре промокода:
 * один выдан, три погашены. Один из погасивших пришёл снова через два дня —
 * он вернулся. Второй «пришёл» через десять минут после погашения — это тот же
 * визит. Третьему повторный чек отменили — визита не было. Вернулся только первый.
 */

const SECRET = 'admin-offers-secret-not-used-anywhere-else'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

let app: INestApplication
let prisma: PrismaService

let restaurantId: string
let studioName: string
let partnershipId: string
let partnerOfferId: string
let endedOfferId: string
let scheduledOfferId: string
let goodwillOfferId: string
let managerToken: string

interface OfferBody {
  id: string
  status: string
  title: string | null
  howTo: string[]
  partner: { partnershipId: string; name: string | null } | null
  issued: number
  redeemed: number
  returned: number
}

const server = (): Server => app.getHttpServer() as Server

const list = async (token: string, query = ''): Promise<OfferBody[]> =>
  (
    (
      await request(server())
        .get(`/v1/admin/offers${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { items: OfferBody[] }
  ).items

const createOffer = async (
  tenantId: string,
  data: {
    type: 'NETWORK_VOUCHER' | 'PROMO_ON_CHECK' | 'GOODWILL'
    status: 'LIVE' | 'SCHEDULED' | 'ENDED'
    title: string
    howTo?: string[]
  },
): Promise<string> => {
  const offer = await prisma.offer.create({
    data: {
      tenantId,
      type: data.type,
      status: data.status,
      visibility: data.type === 'NETWORK_VOUCHER' ? 'PARTNER' : 'VENUE_ONLY',
      audience: {},
      schedule: {},
      limits: {},
      reward: {},
      i18n: { title: { ru: data.title }, howTo: { ru: data.howTo ?? [] } },
    },
    select: { id: true },
  })

  return offer.id
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
  const ledger = moduleRef.get(LedgerService)

  restaurantId = await createTenant(prisma)
  const studioId = await createTenant(prisma)
  studioName = `Студия ${studioId.slice(0, 6)}`
  await prisma.tenant.update({ where: { id: studioId }, data: { brandName: studioName } })

  const partnership = await prisma.partnership.create({
    data: {
      initiatorTenantId: studioId,
      partnerTenantId: restaurantId,
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
    select: { id: true },
  })
  partnershipId = partnership.id

  partnerOfferId = await createOffer(restaurantId, {
    type: 'NETWORK_VOUCHER',
    status: 'LIVE',
    title: 'Ролл Филадельфия в подарок',
    howTo: ['Покажите код на кассе', 'К заказу от 800 ฿'],
  })

  await prisma.partnershipTerm.create({
    data: {
      partnershipId,
      triggerTenantId: studioId,
      rewardTenantId: restaurantId,
      offerId: partnerOfferId,
      trigger: { type: 'ON_PURCHASE', minAmount: 0 },
      reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
      limits: {},
      status: 'ACTIVE',
      proposedBy: restaurantId,
    },
  })

  endedOfferId = await createOffer(restaurantId, {
    type: 'PROMO_ON_CHECK',
    status: 'ENDED',
    title: 'Вернём 200 ฿',
  })
  scheduledOfferId = await createOffer(restaurantId, {
    type: 'PROMO_ON_CHECK',
    status: 'SCHEDULED',
    title: 'Тихие часы',
  })
  goodwillOfferId = await createOffer(restaurantId, {
    type: 'GOODWILL',
    status: 'LIVE',
    title: 'Десерт',
  })

  const grant = async (
    guestId: string,
    state: 'ISSUED' | 'REDEEMED',
    redeemedAt: Date | null,
    receiptId: string | null,
  ): Promise<void> => {
    const code = `OFF${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
    await prisma.offerGrant.create({
      data: {
        offerId: partnerOfferId,
        tenantId: restaurantId,
        guestId,
        code,
        nonce: `nonce-${code}`,
        state,
        redeemedAt,
        redeemedReceiptId: receiptId,
        expiresAt: new Date(Date.now() + 14 * DAY_MS),
      },
    })
  }

  const waiting = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const returning = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const sameVisit = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const cancelled = await createMembershipFixture(prisma, { tenantId: restaurantId })

  await grant(waiting.guestId, 'ISSUED', null, null)
  await grant(returning.guestId, 'REDEEMED', new Date(Date.now() - 2 * DAY_MS), 'R-first')
  await grant(sameVisit.guestId, 'REDEEMED', new Date(Date.now() - 10 * 60 * 1000), 'R-same')
  await grant(cancelled.guestId, 'REDEEMED', new Date(Date.now() - 3 * DAY_MS), 'R-cancelled')

  // Вернувшийся: новый чек через два дня после погашения.
  await ledger.earn(
    {
      membershipId: returning.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-returned'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    returning.scope,
  )

  // Не вернувшийся: чек через десять минут после погашения — тот же визит.
  await ledger.earn(
    {
      membershipId: sameVisit.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-same-visit'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    sameVisit.scope,
  )

  // Не вернувшийся: повторный чек отменили — визита не было.
  const cancelledVisit = await ledger.earn(
    {
      membershipId: cancelled.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-cancelled-visit'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    cancelled.scope,
  )
  await ledger.reverse(
    {
      entryId: cancelledVisit.entry.id,
      idempotencyKey: idempotencyKey('offers-cancelled-reverse'),
      reason: 'WRONG_AMOUNT',
      ...POS_ORIGIN,
    },
    cancelled.scope,
  )

  managerToken = signAccessToken({ tenantId: restaurantId, actorId: null, role: 'MANAGER' }, SECRET)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Список акций', () => {
  it('ПАРТНЁРСКАЯ АКЦИЯ — С ПОМЕТКОЙ ПАРТНЁРА; ПОДАРКИ ИЗ КАРТОЧКИ ГОСТЯ В СПИСКЕ НЕ ЖИВУТ', async () => {
    const items = await list(managerToken)
    const ids = items.map((item) => item.id)

    expect(ids).toEqual([partnerOfferId, scheduledOfferId, endedOfferId])
    expect(ids).not.toContain(goodwillOfferId)

    expect(items[0]).toMatchObject({
      status: 'LIVE',
      title: 'Ролл Филадельфия в подарок',
      howTo: ['Покажите код на кассе', 'К заказу от 800 ฿'],
      partner: { partnershipId, name: studioName },
    })
    expect(items.find((item) => item.id === endedOfferId)?.partner).toBeNull()
  })

  it('ВЫДАНО, ИСПОЛЬЗОВАНО, ВЕРНУЛОСЬ — ВЕРНУВШИМСЯ СЧИТАЕТСЯ ТОЛЬКО ПРИШЕДШИЙ СНОВА С НЕОТМЕНЁННЫМ ЧЕКОМ', async () => {
    const partner = (await list(managerToken)).find((item) => item.id === partnerOfferId)

    expect(partner).toMatchObject({ issued: 4, redeemed: 3, returned: 1 })
  })

  it('фильтры: идут и завершённые', async () => {
    expect((await list(managerToken, '?filter=LIVE')).map((item) => item.id)).toEqual([
      partnerOfferId,
    ])
    expect((await list(managerToken, '?filter=ENDED')).map((item) => item.id)).toEqual([
      endedOfferId,
    ])
  })

  it('чужие акции не видны; кассиру — 403; неизвестный фильтр — 400', async () => {
    const neighbour = await createTenant(prisma)
    const neighbourToken = signAccessToken(
      { tenantId: neighbour, actorId: null, role: 'OWNER' },
      SECRET,
    )

    expect(await list(neighbourToken)).toEqual([])

    await request(server())
      .get('/v1/admin/offers')
      .set(
        'Authorization',
        `Bearer ${signAccessToken({ tenantId: restaurantId, actorId: null, role: 'CASHIER' }, SECRET)}`,
      )
      .expect(403)

    await request(server())
      .get('/v1/admin/offers?filter=SECRET')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(400)
  })
})
