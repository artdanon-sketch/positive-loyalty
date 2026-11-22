import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { parseProgramConfig } from '@positive/contracts'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { MembershipRulesService } from '../../src/core/membership-rules.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'

/**
 * Подарки первой покупки и отмена чека. docs/05, раздел 6.6.
 *
 * Решение владельца 14.11.2026: отмена единственной покупки гостя забирает
 * приветственные баллы и награду пригласившему, следующая настоящая покупка
 * выдаёт их снова.
 */

const SECRET = 'first-purchase-gifts-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

interface Venue {
  tenantId: string
  cashier: string
}

const openVenue = async (settings: Record<string, unknown>): Promise<Venue> => {
  const tenantId = await createTenant(prisma)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        baseEarnRate: 10,
        baseRedeemRate: 20,
        cashierRules: { requireReceiptNumber: false },
        ...settings,
      },
    },
  })
  const staff = await prisma.staff.create({
    data: { tenantId, role: 'CASHIER', displayName: 'Кассир' },
    select: { id: true },
  })
  return {
    tenantId,
    cashier: signAccessToken({ tenantId, actorId: staff.id, role: 'CASHIER' }, SECRET, 3600),
  }
}

const sale = async (venue: Venue, membershipId: string): Promise<string> => {
  const preview = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${venue.cashier}`)
    .send({ membershipId, amount: 100_000 })
    .expect(200)
  const commit = await request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${venue.cashier}`)
    .send({
      previewId: (preview.body as { previewId: string }).previewId,
      receiptId: `gift-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    })
    .expect(200)
  return (commit.body as { transactionId: string }).transactionId
}

const voidSale = (venue: Venue, transactionId: string): request.Test =>
  request(server())
    .post(`/v1/pos/transactions/${transactionId}/void`)
    .set('Authorization', `Bearer ${venue.cashier}`)
    .send({ reason: 'WRONG_AMOUNT' })

const balance = async (membershipId: string): Promise<number> =>
  (await prisma.membership.findFirstOrThrow({ where: { id: membershipId } })).pointsBalance

const GIFTS = {
  welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
  referral: { enabled: true, reward: 3_000, limit: 1, levels: [0, 0, 0] },
}

/** Пригласивший и друг: друг пришёл по ссылке и ещё ничего не купил. */
const invited = async (venue: Venue): Promise<{ inviter: string; friend: string }> => {
  const inviter = await createMembershipFixture(prisma, { tenantId: venue.tenantId })
  const friend = await createMembershipFixture(prisma, { tenantId: venue.tenantId })
  await prisma.membership.update({
    where: { id: friend.membershipId },
    data: { referredById: inviter.membershipId, source: 'REFERRAL' },
  })
  return { inviter: inviter.membershipId, friend: friend.membershipId }
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

describe('Подарки первой покупки при отмене чека', () => {
  it('ОТМЕНА ЕДИНСТВЕННОЙ ПОКУПКИ ЗАБИРАЕТ ПРИВЕТСТВЕННЫЕ БАЛЛЫ И НАГРАДУ ЗА ДРУГА', async () => {
    const venue = await openVenue(GIFTS)
    const { inviter, friend } = await invited(venue)

    const first = await sale(venue, friend)
    // 10 % от 1000 ฿ = 10 000 и 5 000 приветственных; пригласившему — 3 000.
    expect([await balance(friend), await balance(inviter)]).toEqual([15_000, 3_000])

    await voidSale(venue, first).expect(200)
    expect([await balance(friend), await balance(inviter)]).toEqual([0, 0])

    // Повтор отмены ничего не меняет.
    await voidSale(venue, first).expect(200)
    expect([await balance(friend), await balance(inviter)]).toEqual([0, 0])
  })

  it('СЛЕДУЮЩАЯ НАСТОЯЩАЯ ПОКУПКА ВЫДАЁТ ПОДАРКИ СНОВА — И ЛИМИТ НЕ СЪЕДЕН', async () => {
    const venue = await openVenue(GIFTS)
    const { inviter, friend } = await invited(venue)

    await voidSale(venue, await sale(venue, friend)).expect(200)
    await sale(venue, friend)

    // Лимит наград пригласившего — один друг: отменённая награда его не занимает.
    expect([await balance(friend), await balance(inviter)]).toEqual([15_000, 3_000])
  })

  it('ПОКА ЕСТЬ ДРУГАЯ ПОКУПКА, ОТМЕНА ВТОРОГО ЧЕКА ПОДАРКИ НЕ ТРОГАЕТ', async () => {
    const venue = await openVenue(GIFTS)
    const { inviter, friend } = await invited(venue)

    await sale(venue, friend)
    const second = await sale(venue, friend)
    await voidSale(venue, second).expect(200)

    expect([await balance(friend), await balance(inviter)]).toEqual([15_000, 3_000])
  })

  it('ПОДАРОК ЗА ВСТУПЛЕНИЕ ОТМЕНА ЧЕКА НЕ ЗАБИРАЕТ', async () => {
    const venue = await openVenue({
      welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_JOIN' },
    })
    const guest = await createMembershipFixture(prisma, { tenantId: venue.tenantId })
    // Подарок при вступлении — тем же сервисом, что и при записи гостя.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { id: guest.membershipId },
    })
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: venue.tenantId } })
    await app
      .get(MembershipRulesService)
      .grantWelcome(venue.tenantId, membership, parseProgramConfig(tenant.settings), 'JOIN')
    expect(await balance(guest.membershipId)).toBe(5_000)

    await voidSale(venue, await sale(venue, guest.membershipId)).expect(200)
    expect(await balance(guest.membershipId)).toBe(5_000)
  })
})
