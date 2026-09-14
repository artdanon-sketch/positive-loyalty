import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'

/**
 * Советы про партнёров на «Обзоре». docs/10, раздел 5.1 · docs/02, раздел 5.1.
 *
 * Партнёрства и подарки заводятся прямо в базе: переговоры проверены
 * в partnerships-negotiation и partnership-terms, здесь важно только,
 * какие советы из готовой картины увидит владелец.
 */

const SECRET = 'partnership-advice-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService

interface Venue {
  id: string
  brandName: string
  manager: string
}

type Advice = Array<Record<string, unknown>>

const server = (): Server => app.getHttpServer() as Server

const venue = async (name: string): Promise<Venue> => {
  const id = await createTenant(prisma)
  const brandName = `${name} ${id.slice(0, 6)}`
  await prisma.tenant.update({ where: { id }, data: { brandName } })

  return {
    id,
    brandName,
    manager: signAccessToken({ tenantId: id, actorId: null, role: 'MANAGER' }, SECRET),
  }
}

const advice = async (token: string): Promise<Advice> =>
  (
    (
      await request(server())
        .get('/v1/admin/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { advice: Advice }
  ).advice

const TERM_SHAPE = {
  trigger: { type: 'ON_PURCHASE', minAmount: 0 },
  reward: { kind: 'FREE_ITEM', itemName: 'Ролл', minCheck: 0 },
  limits: {},
}

/** Действующее партнёрство, где ресторан дарит ролл гостям студии. */
const restaurantGivesToStudio = async (
  studio: Venue,
  restaurant: Venue,
): Promise<{ partnershipId: string; offerId: string }> => {
  const partnership = await prisma.partnership.create({
    data: {
      initiatorTenantId: studio.id,
      partnerTenantId: restaurant.id,
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
    select: { id: true },
  })

  const offer = await prisma.offer.create({
    data: {
      tenantId: restaurant.id,
      type: 'NETWORK_VOUCHER',
      status: 'LIVE',
      visibility: 'PARTNER',
      audience: {},
      schedule: {},
      limits: {},
      reward: {},
      i18n: {},
    },
    select: { id: true },
  })

  await prisma.partnershipTerm.create({
    data: {
      partnershipId: partnership.id,
      triggerTenantId: studio.id,
      rewardTenantId: restaurant.id,
      offerId: offer.id,
      ...TERM_SHAPE,
      status: 'ACTIVE',
      proposedBy: restaurant.id,
    },
  })

  return { partnershipId: partnership.id, offerId: offer.id }
}

/** Гости студии гасят ролл в ресторане. */
const redeemAtRestaurant = async (
  studio: Venue,
  restaurant: Venue,
  offerId: string,
  guests: number,
  redeemedAt: Date,
): Promise<void> => {
  for (let index = 0; index < guests; index += 1) {
    const guest = await createMembershipFixture(prisma, { tenantId: studio.id })
    const code = `ADV${String(index)}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

    await prisma.offerGrant.create({
      data: {
        offerId,
        tenantId: restaurant.id,
        guestId: guest.guestId,
        code,
        nonce: `nonce-${code}`,
        state: 'REDEEMED',
        issuedAt: redeemedAt,
        redeemedAt,
        expiresAt: new Date(redeemedAt.getTime() + 14 * DAY_MS),
      },
    })
  }
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
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Советы про партнёров', () => {
  it('ПАРТНЁР ПРИСЛАЛ 10 ГОСТЕЙ, ОТВЕТНОГО НЕТ — СОВЕТ; ОТВЕТНОЕ ПРЕДЛОЖЕНО — СОВЕТ УШЁЛ', async () => {
    const studio = await venue('Студия')
    const restaurant = await venue('Ресторан')
    const { partnershipId, offerId } = await restaurantGivesToStudio(studio, restaurant)

    await redeemAtRestaurant(studio, restaurant, offerId, 10, new Date())

    expect(await advice(restaurant.manager)).toContainEqual({
      kind: 'PARTNER_RECIPROCATE',
      partnershipId,
      partnerName: studio.brandName,
      guests: 10,
    })

    // Студия предлагает ответное: теперь она дарит гостям ресторана.
    await prisma.partnershipTerm.create({
      data: {
        partnershipId,
        triggerTenantId: restaurant.id,
        rewardTenantId: studio.id,
        ...TERM_SHAPE,
        status: 'PROPOSED',
        proposedBy: studio.id,
      },
    })

    const after = await advice(restaurant.manager)

    expect(after.some((item) => item['kind'] === 'PARTNER_RECIPROCATE')).toBe(false)
    // А предложенное студией условие ждёт ответа ресторана.
    expect(after).toContainEqual({ kind: 'PARTNERS_WAITING', invites: 0, terms: 1 })
  })

  it('ДЕВЯТЬ ГОСТЕЙ — ЕЩЁ НЕ ПОВОД; ПОГАШЕНИЯ СТАРШЕ МЕСЯЦА НЕ В СЧЁТ', async () => {
    const studio = await venue('Студия')
    const restaurant = await venue('Ресторан')
    const { offerId } = await restaurantGivesToStudio(studio, restaurant)

    await redeemAtRestaurant(studio, restaurant, offerId, 9, new Date())
    await redeemAtRestaurant(studio, restaurant, offerId, 5, new Date(Date.now() - 40 * DAY_MS))

    expect(
      (await advice(restaurant.manager)).some((item) => item['kind'] === 'PARTNER_RECIPROCATE'),
    ).toBe(false)
  })

  it('ВХОДЯЩЕЕ ПРИГЛАШЕНИЕ ЖДЁТ ОТВЕТА — СОВЕТ У ПОЛУЧАТЕЛЯ, А НЕ У ОТПРАВИТЕЛЯ', async () => {
    const inviter = await venue('Спа')
    const invitee = await venue('Кафе')

    await prisma.partnership.create({
      data: { initiatorTenantId: inviter.id, partnerTenantId: invitee.id, status: 'PROPOSED' },
    })

    expect(await advice(invitee.manager)).toContainEqual({
      kind: 'PARTNERS_WAITING',
      invites: 1,
      terms: 0,
    })
    expect(
      (await advice(inviter.manager)).some((item) => item['kind'] === 'PARTNERS_WAITING'),
    ).toBe(false)
  })
})
