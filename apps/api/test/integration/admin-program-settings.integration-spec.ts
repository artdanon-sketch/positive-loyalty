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
 * Настройки программы. docs/02, раздел 5.6.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 * Не «ручка сохраняет JSON», а то, ради чего настройки существуют:
 *
 *   касса применяет    новый процент начисления со следующего же чека — иначе
 *                      экран обещает то, чего касса не делает;
 *   остальное цело     статусы и приветственные баллы, заведённые при подключении,
 *                      не стираются сохранением трёх полей;
 *   сосед не задет     изменение одного заведения не меняет чеки другого;
 *   мусор не проходит  невозможный процент отвергается, и касса продолжает
 *                      работать на прежних настройках;
 *   аудит              что было и что стало — изменение денег заведения
 *                      без следа недопустимо (docs/05, раздел 10).
 */

const SECRET = 'admin-program-settings-secret-not-used-anywhere-else'
const HOUR = 60 * 60

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

const token = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET, HOUR)

const defaults = {
  baseEarnRate: 5,
  baseRedeemRate: 20,
  // Баллы не сгорают, пока владелец не поставил срок (docs/02, раздел 5.6.8).
  pointsExpireDays: null,
  // Теги на кассе выключены у нового заведения: их включает владелец,
  // зная свои теги (docs/02, раздел 3.7).
  cashierRules: {
    requireReceiptNumber: true,
    maxManualAmount: null,
    allowManualEntry: true,
    showGuestTags: false,
    allowTagging: false,
    // Экран кассира: свою историю и показатели владелец открывает сам,
    // а пригласить гостя кассир может сразу (docs/02, раздел 3.9).
    showOwnHistory: false,
    showOwnStats: false,
    allowInvite: true,
  },
}

/** Заведение с гостем и токенами владельца и кассира. */
const venue = async (): Promise<{
  tenantId: string
  membershipId: string
  owner: string
  cashier: string
}> => {
  const tenantId = await createTenant(prisma)
  const { membershipId } = await createMembershipFixture(prisma, { tenantId })

  return {
    tenantId,
    membershipId,
    owner: token(tenantId, 'OWNER'),
    cashier: token(tenantId, 'CASHIER'),
  }
}

/** Сколько баллов касса пообещает за чек в 1 000 ฿. */
const earnedFor = async (
  place: { membershipId: string; cashier: string },
  options: { receiptNumber?: string } = { receiptNumber: 'R-1' },
): Promise<number> => {
  const response = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${place.cashier}`)
    .send({
      membershipId: place.membershipId,
      amount: 100_000,
      ...(options.receiptNumber === undefined ? {} : { receiptNumber: options.receiptNumber }),
    })
    .expect(200)

  return (response.body as { pointsToEarn: number }).pointsToEarn
}

const save = (ownerToken: string, body: object) =>
  request(server())
    .put('/v1/admin/settings/program')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send(body)

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

describe('Настройки программы', () => {
  it('у нового заведения — значения по умолчанию', async () => {
    const place = await venue()

    const response = await request(server())
      .get('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.owner}`)
      .expect(200)

    expect(response.body).toEqual(defaults)
  })

  it('НОВЫЙ ПРОЦЕНТ НАЧИСЛЕНИЯ КАССА ПРИМЕНЯЕТ СО СЛЕДУЮЩЕГО ЧЕКА', async () => {
    const place = await venue()

    // 5% от 1 000 ฿.
    expect(await earnedFor(place)).toBe(5_000)

    await save(place.owner, { ...defaults, baseEarnRate: 10 }).expect(200)

    // Иначе экран обещает то, чего касса не делает.
    expect(await earnedFor(place)).toBe(10_000)
  })

  it('ПРАВИЛО «НОМЕР ЧЕКА ОБЯЗАТЕЛЕН» КАССА СОБЛЮДАЕТ СРАЗУ', async () => {
    const place = await venue()

    await request(server())
      .post('/v1/pos/transactions/preview')
      .set('Authorization', `Bearer ${place.cashier}`)
      .send({ membershipId: place.membershipId, amount: 100_000 })
      .expect(400)

    await save(place.owner, {
      ...defaults,
      cashierRules: { ...defaults.cashierRules, requireReceiptNumber: false },
    }).expect(200)

    expect(await earnedFor(place, {})).toBe(5_000)
  })

  it('ОСТАЛЬНЫЕ НАСТРОЙКИ ЗАВЕДЕНИЯ НЕ СТИРАЮТСЯ', async () => {
    // Статусы и приветственные баллы заводятся при подключении. Сохранение трёх
    // полей на экране настроек не должно стирать их одним нажатием.
    const place = await venue()

    await prisma.tenant.update({
      where: { id: place.tenantId },
      data: {
        settings: {
          welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
          tiers: [
            {
              id: 'regular',
              name: 'Постоянный',
              earnRate: 7,
              redeemRate: 40,
              hidden: false,
              conditions: [{ type: 'VISITS_TOTAL', gt: 5 }],
            },
          ],
        },
      },
    })

    await save(place.owner, { ...defaults, baseEarnRate: 8 }).expect(200)

    const tenant = await prisma.tenant.findUnique({
      where: { id: place.tenantId },
      select: { settings: true },
    })
    const settings = tenant?.settings as {
      baseEarnRate: number
      welcomeBonus: { enabled: boolean }
      tiers: unknown[]
    }

    expect(settings.baseEarnRate).toBe(8)
    expect(settings.welcomeBonus.enabled).toBe(true)
    expect(settings.tiers).toHaveLength(1)
  })

  it('невозможный процент отвергается, и касса работает на прежних настройках', async () => {
    const place = await venue()

    await save(place.owner, { ...defaults, baseEarnRate: 80 }).expect(400)

    expect(await earnedFor(place)).toBe(5_000)
  })

  it('СРОК ЖИЗНИ БАЛЛОВ СОХРАНЯЕТСЯ: МЕХАНИКА ПОД НИМ ПОЯВИЛАСЬ', async () => {
    const place = await venue()

    await save(place.owner, { ...defaults, pointsExpireDays: 365 }).expect(200)

    const response = await request(server())
      .get('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.owner}`)
      .expect(200)

    expect(response.body).toMatchObject({ pointsExpireDays: 365 })
  })

  it('МЕНЬШЕ МЕСЯЦА ПОСТАВИТЬ НЕЛЬЗЯ: ЭТО СПОСОБ ПОССОРИТЬСЯ С ГОСТЕМ', async () => {
    const place = await venue()

    await save(place.owner, { ...defaults, pointsExpireDays: 7 }).expect(400)
  })

  it('ИЗМЕНЕНИЕ У СОСЕДА НЕ ТРОГАЕТ ЭТО ЗАВЕДЕНИЕ', async () => {
    const mine = await venue()
    const neighbour = await venue()

    await save(neighbour.owner, { ...defaults, baseEarnRate: 12 }).expect(200)

    expect(await earnedFor(mine)).toBe(5_000)
    expect(await earnedFor(neighbour)).toBe(12_000)
  })

  it('МЕНЕДЖЕР НАСТРОЙКИ НЕ МЕНЯЕТ И НЕ ЧИТАЕТ', async () => {
    // Процент начисления — деньги заведения. Менеджер, способный поднять его
    // себе в смену, раздавал бы чужую выручку баллами.
    const place = await venue()
    const manager = token(place.tenantId, 'MANAGER')

    await request(server())
      .get('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${manager}`)
      .expect(403)

    await save(manager, { ...defaults, baseEarnRate: 40 }).expect(403)

    expect(await earnedFor(place)).toBe(5_000)
  })

  it('ИЗМЕНЕНИЕ ПОПАДАЕТ В АУДИТ — ЧТО БЫЛО И ЧТО СТАЛО', async () => {
    const place = await venue()

    await save(place.owner, { ...defaults, baseEarnRate: 7 }).expect(200)

    const rows = await prisma.$queryRaw<Array<{ oldValue: unknown; newValue: unknown }>>`
      SELECT "oldValue", "newValue" FROM "AuditLog"
      WHERE "tenantId" = ${place.tenantId} AND "action" = 'PROGRAM_CONFIG_CHANGED'
    `

    expect(rows).toHaveLength(1)
    expect((rows[0]?.oldValue as { baseEarnRate: number }).baseEarnRate).toBe(5)
    expect((rows[0]?.newValue as { baseEarnRate: number }).baseEarnRate).toBe(7)
  })
})
