import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { signAccessToken, signGuestQrToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'
import type { Prisma } from '../../src/generated/prisma/client'

import { createMembershipFixture, createTenant, idempotencyKey } from './ledger-test-context'

/**
 * Статусы гостей и приветственные баллы.
 * docs/02, разделы 3.1–3.3, 5.2.2, 5.6.1 · docs/11, У3.
 *
 * Каждый тест — своё заведение: настройки программы общие на заведение, и соседние
 * тесты иначе видели бы чужую лестницу.
 */

const SECRET = 'tiers-secret-not-used-anywhere-else'

interface Venue {
  tenantId: string
  guestId: string
  membershipId: string
  cashier: string
  owner: string
  manager: string
}

interface GuestBody {
  membershipId: string
  points: number
  tier: { id: string; name: string; earnRate: number; redeemRate: number } | null
}

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService

const server = (): Server => app.getHttpServer() as Server

const BASE = {
  id: 'base',
  name: 'Гость',
  earnRate: 5,
  redeemRate: 20,
  hidden: false,
  conditions: [],
}

const GOLD = {
  id: 'gold',
  name: 'Золото',
  earnRate: 10,
  redeemRate: 50,
  hidden: false,
  conditions: [{ type: 'SPENT_TOTAL', gt: 100_000 }],
}

const FRIENDS = {
  id: 'friends',
  name: 'Друзья',
  earnRate: 20,
  redeemRate: 100,
  hidden: true,
  conditions: [],
}

const LADDER = {
  tiers: [BASE, GOLD, FRIENDS],
  welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_FIRST_PURCHASE' },
}

/** Заведение с базовой ставкой 5%, кассиром на смене и одним гостем. */
const openVenue = async (settings: Prisma.InputJsonObject = {}): Promise<Venue> => {
  const fixture = await createMembershipFixture(prisma)

  await prisma.tenant.update({
    where: { id: fixture.tenantId },
    data: {
      settings: {
        baseEarnRate: 5,
        baseRedeemRate: 20,
        cashierRules: { requireReceiptNumber: false },
        ...settings,
      },
    },
  })

  const staff = await prisma.staff.create({
    data: {
      tenantId: fixture.tenantId,
      role: 'CASHIER',
      displayName: 'Кассир на смене',
      pinHash: await hashPin('7412'),
    },
    select: { id: true },
  })

  const token = (role: 'OWNER' | 'MANAGER' | 'CASHIER', actorId: string | null = null): string =>
    signAccessToken({ tenantId: fixture.tenantId, actorId, role }, SECRET)

  return {
    tenantId: fixture.tenantId,
    guestId: fixture.guestId,
    membershipId: fixture.membershipId,
    cashier: token('CASHIER', staff.id),
    owner: token('OWNER'),
    manager: token('MANAGER'),
  }
}

const preview = async (venue: Venue, amount: number, membershipId = venue.membershipId) =>
  (
    await request(server())
      .post('/v1/pos/transactions/preview')
      .set('Authorization', `Bearer ${venue.cashier}`)
      .send({ membershipId, amount })
      .expect(200)
  ).body as {
    previewId: string
    pointsToEarn: number
    maxRedeemable: number
    welcomeBonus: number
  }

const sale = async (venue: Venue, amount: number, membershipId = venue.membershipId) => {
  const counted = await preview(venue, amount, membershipId)

  return (
    await request(server())
      .post('/v1/pos/transactions/commit')
      .set('Authorization', `Bearer ${venue.cashier}`)
      .send({ previewId: counted.previewId, receiptId: `rcpt-tiers-${randomUUID()}` })
      .expect(200)
  ).body as { earned: number; newBalance: number; welcomeBonus: number }
}

const lookup = async (venue: Venue, guestId: string) =>
  (
    await request(server())
      .get('/v1/pos/guest')
      .query({ token: signGuestQrToken({ guestId }, SECRET) })
      .set('Authorization', `Bearer ${venue.cashier}`)
      .expect(200)
  ).body as GuestBody

const membershipOf = async (id: string) =>
  prisma.membership.findUniqueOrThrow({
    where: { id },
    select: {
      tierId: true,
      tierManual: true,
      pointsBalance: true,
      visitsTotal: true,
      spentTotal: true,
    },
  })

const welcomeEntries = async (membershipId: string): Promise<number> =>
  prisma.ledgerEntry.count({
    where: { membershipId, type: 'GRANT', idempotencyKey: `welcome:${membershipId}` },
  })

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

describe('Лестница статусов в настройках', () => {
  it('ЛЕСТНИЦА СОХРАНЯЕТСЯ, НЕ ТРОГАЯ БАЗОВЫХ СТАВОК; МЕНЕДЖЕРУ — 403; ДВА СТАТУСА С ОДНИМ ID — 400', async () => {
    const venue = await openVenue()
    const put = (body: object, token = venue.owner) =>
      request(server())
        .put('/v1/admin/settings/program/tiers')
        .set('Authorization', `Bearer ${token}`)
        .send(body)

    expect((await put(LADDER)).body).toEqual(LADDER)

    const read = await request(server())
      .get('/v1/admin/settings/program/tiers')
      .set('Authorization', `Bearer ${venue.owner}`)
      .expect(200)
    expect(read.body).toEqual(LADDER)

    const settings = await request(server())
      .get('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${venue.owner}`)
      .expect(200)
    expect(settings.body).toMatchObject({ baseEarnRate: 5, baseRedeemRate: 20 })

    expect((await put(LADDER, venue.manager)).status).toBe(403)
    expect((await put({ ...LADDER, tiers: [BASE, { ...BASE, name: 'Другой' }] })).status).toBe(400)
  })
})

describe('Статус на кассе', () => {
  it('ГОСТЬ ПЕРЕШЁЛ ПОРОГ — СЛЕДУЮЩИЙ ЧЕК ПО СТАВКАМ «ЗОЛОТА»: 10% НАЧИСЛЕНИЯ И ПОЛОВИНА ЧЕКА БАЛЛАМИ', async () => {
    const venue = await openVenue({ tiers: LADDER.tiers })

    expect((await lookup(venue, venue.guestId)).tier).toMatchObject({ id: 'base', earnRate: 5 })

    const first = await sale(venue, 150_000)

    expect(first.earned).toBe(7_500)
    expect(await membershipOf(venue.membershipId)).toMatchObject({
      tierId: 'gold',
      tierManual: false,
    })

    const next = await preview(venue, 10_000)

    expect(next.pointsToEarn).toBe(1_000)
    // Баллов 7 500, половина чека — 5 000. По базовой ставке было бы 2 000.
    expect(next.maxRedeemable).toBe(5_000)

    expect((await lookup(venue, venue.guestId)).tier).toEqual({
      id: 'gold',
      name: 'Золото',
      earnRate: 10,
      redeemRate: 50,
    })
  })

  it('РУЧНОЙ СКРЫТЫЙ СТАТУС НЕ СЛЕТАЕТ ПОСЛЕ ЧЕКА; «ВЕРНУТЬ НА ЛЕСТНИЦУ» СЧИТАЕТ ЗАНОВО; ПРИЧИНА — В АУДИТЕ', async () => {
    const venue = await openVenue({ tiers: LADDER.tiers })
    const setTier = (body: object, token = venue.owner, guestId = venue.guestId) =>
      request(server())
        .put(`/v1/admin/guests/${guestId}/tier`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)

    const vip = await setTier({ tierId: 'friends', reason: 'Друг владельца, ходит с открытия' })

    expect(vip.status).toBe(200)
    expect(vip.body).toEqual({ tierId: 'friends', name: 'Друзья', manual: true })

    expect((await preview(venue, 10_000)).pointsToEarn).toBe(2_000)
    await sale(venue, 200_000)
    expect(await membershipOf(venue.membershipId)).toMatchObject({
      tierId: 'friends',
      tierManual: true,
    })

    const back = await setTier({ tierId: null, reason: 'Статус выдан по ошибке' })

    // За чек в 2 000 ฿ гость уже выше порога «Золота».
    expect(back.body).toEqual({ tierId: 'gold', name: 'Золото', manual: false })
    expect(
      await prisma.auditLog.count({
        where: { tenantId: venue.tenantId, action: 'GUEST_TIER_CHANGED', reason: { not: null } },
      }),
    ).toBe(2)

    const unknown = await setTier({ tierId: 'platinum', reason: 'Такого статуса нет вовсе' })

    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'UNKNOWN_TIER' } })
    expect(
      (await setTier({ tierId: 'gold', reason: 'Менеджер решил сам' }, venue.manager)).status,
    ).toBe(403)
    expect((await setTier({ tierId: 'gold', reason: 'надо' })).status).toBe(400)

    const neighbour = await createTenant(prisma)
    const stranger = signAccessToken({ tenantId: neighbour, actorId: null, role: 'OWNER' }, SECRET)

    expect(
      (await setTier({ tierId: 'gold', reason: 'Чужой гость в чужом заведении' }, stranger)).status,
    ).toBe(404)
  })
})

describe('Приветственные баллы', () => {
  it('ПОВТОР ПРОВЕДЕНИЯ ПЕРВОГО ЧЕКА ТОЖЕ ГОВОРИТ О ПОДАРКЕ, ВТОРОЙ ЧЕК — НЕТ', async () => {
    const venue = await openVenue({
      welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
    })
    const receiptId = `rcpt-welcome-${randomUUID()}`
    const commit = async (previewId: string) =>
      (
        await request(server())
          .post('/v1/pos/transactions/commit')
          .set('Authorization', `Bearer ${venue.cashier}`)
          .send({ previewId, receiptId })
          .expect(200)
      ).body as { welcomeBonus: number; replayed: boolean }

    expect(await commit((await preview(venue, 100_000)).previewId)).toMatchObject({
      welcomeBonus: 5_000,
      replayed: false,
    })
    // Связь оборвалась, касса повторила тем же номером чека.
    expect(await commit((await preview(venue, 100_000)).previewId)).toMatchObject({
      welcomeBonus: 5_000,
      replayed: true,
    })
    expect((await sale(venue, 100_000)).welcomeBonus).toBe(0)
  })

  it('ЗА ПЕРВУЮ ПОКУПКУ — ОДИН РАЗ, ЖУРНАЛОМ, БЕЗ ЛИШНЕГО ВИЗИТА; КОНТРОЛЬНОЙ ГРУППЕ — НЕТ', async () => {
    const venue = await openVenue({
      welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
    })

    // Касса знает о подарке ДО проведения: кассир называет его гостю вслух,
    // а «станет на карте» сходится с картой.
    expect((await preview(venue, 100_000)).welcomeBonus).toBe(5_000)

    const first = await sale(venue, 100_000)

    // 5% от 1 000 ฿ — 5 000 баллов, и столько же приветственных.
    expect(first).toMatchObject({ earned: 5_000, newBalance: 10_000, welcomeBonus: 5_000 })
    expect(await welcomeEntries(venue.membershipId)).toBe(1)
    expect(await membershipOf(venue.membershipId)).toMatchObject({
      visitsTotal: 1,
      pointsBalance: 10_000,
    })

    // Второй чек — без подарка, и касса это тоже знает заранее.
    expect((await preview(venue, 100_000)).welcomeBonus).toBe(0)
    const second = await sale(venue, 100_000)
    expect(second).toMatchObject({ newBalance: 15_000, welcomeBonus: 0 })
    expect(await welcomeEntries(venue.membershipId)).toBe(1)

    const control = await createMembershipFixture(prisma, { tenantId: venue.tenantId })
    await prisma.membership.update({
      where: { id: control.membershipId },
      data: { isControlGroup: true },
    })
    await sale(venue, 100_000, control.membershipId)

    expect(await welcomeEntries(control.membershipId)).toBe(0)
  })

  it('ПРИ ВСТУПЛЕНИИ — С ПЕРВОГО СКАНИРОВАНИЯ; ПОВТОРНОЕ СКАНИРОВАНИЕ НЕ УДВАИВАЕТ', async () => {
    const venue = await openVenue({
      welcomeBonus: { enabled: true, amount: 3_000, trigger: 'ON_JOIN' },
    })
    // Гость сети, впервые пришедший в это заведение: участие у него только в соседнем.
    const newcomer = await createMembershipFixture(prisma)

    const joined = await lookup(venue, newcomer.guestId)

    expect(joined.points).toBe(3_000)
    expect((await lookup(venue, newcomer.guestId)).points).toBe(3_000)
    expect(await welcomeEntries(joined.membershipId)).toBe(1)
    expect(await membershipOf(joined.membershipId)).toMatchObject({
      visitsTotal: 0,
      pointsBalance: 3_000,
    })
  })
})

describe('Подарок баллами в журнале', () => {
  it('ПОДАРОК НЕ ДВИГАЕТ ВИЗИТЫ И ОБОРОТ; ПОВТОР С ТЕМ ЖЕ КЛЮЧОМ — ТА ЖЕ ЗАПИСЬ; ОТМЕНА ВОЗВРАЩАЕТ БАЛАНС', async () => {
    const fixture = await createMembershipFixture(prisma)
    const input = {
      membershipId: fixture.membershipId,
      amount: 2_500,
      idempotencyKey: idempotencyKey('grant'),
      source: 'SYSTEM' as const,
      actorType: 'SYSTEM' as const,
    }

    const first = await ledger.grant(input, fixture.scope)
    const again = await ledger.grant(input, fixture.scope)

    expect(again.replayed).toBe(true)
    expect(again.entry.id).toBe(first.entry.id)
    expect(await membershipOf(fixture.membershipId)).toMatchObject({
      pointsBalance: 2_500,
      visitsTotal: 0,
      spentTotal: 0,
    })

    await ledger.reverse(
      {
        entryId: first.entry.id,
        idempotencyKey: idempotencyKey('grant-reverse'),
        reason: 'WRONG_AMOUNT',
        source: 'SYSTEM',
        actorType: 'SYSTEM',
      },
      fixture.scope,
    )

    expect(await membershipOf(fixture.membershipId)).toMatchObject({
      pointsBalance: 0,
      visitsTotal: 0,
    })
  })
})
