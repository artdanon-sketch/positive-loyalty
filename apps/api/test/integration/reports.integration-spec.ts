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
import type { MembershipFixture } from './ledger-test-context'

/**
 * Отчёты: клиенты, операции, RFM, сотрудники. docs/02, раздел 5.10 · docs/11, У8.
 *
 * Приёмка из docs/11: цифры отчётов сходятся с журналом. Полигон — заведение, где:
 * - турист провёл у кассира три чека (100, 200 и 300 ฿) и оплатил баллами 5 ฿;
 * - резидент пришёл через кассу POSitive: один чек на 400 ฿ и один отменённый на 500 ฿;
 * - третий гость вступил и ничего не купил.
 * У соседнего заведения — свой чек на 10 000 ฿: он не должен попасть ни в одну цифру.
 */

const SECRET = 'reports-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let tenantId: string
let tourist: MembershipFixture
let resident: MembershipFixture
let cashierId: string
let managerToken: string
let cashierToken: string

const server = (): Server => app.getHttpServer() as Server

const get = (path: string, token: string = managerToken) =>
  request(server()).get(path).set('Authorization', `Bearer ${token}`)

type Origin =
  | typeof POS_ORIGIN
  | { readonly source: 'STAFF_MANUAL'; readonly actorType: 'STAFF'; readonly actorId: string }

const earn = async (
  membership: MembershipFixture,
  basisAmount: number,
  origin: Origin,
): Promise<string> => {
  const receipt = `rep-${randomUUID().slice(0, 8)}`
  const result = await ledger.earn(
    {
      membershipId: membership.membershipId,
      amount: Math.floor(basisAmount / 20),
      basisAmount,
      idempotencyKey: idempotencyKey('report-earn'),
      refType: 'receipt',
      refId: receipt,
      ...origin,
    },
    membership.scope,
  )

  return result.entry.id
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

  tenantId = await createTenant(prisma)
  tourist = await createMembershipFixture(prisma, { tenantId })
  resident = await createMembershipFixture(prisma, { tenantId })
  await createMembershipFixture(prisma, { tenantId })

  await prisma.guest.update({ where: { id: resident.guestId }, data: { mode: 'RESIDENT' } })

  const cashier = await prisma.staff.create({
    data: { tenantId, displayName: 'Кассир Лек', role: 'CASHIER' },
    select: { id: true },
  })
  cashierId = cashier.id

  const byCashier = { source: 'STAFF_MANUAL', actorType: 'STAFF', actorId: cashierId } as const

  const rated = await earn(tourist, 10_000, byCashier)
  const alsoRated = await earn(tourist, 20_000, byCashier)
  await earn(tourist, 30_000, byCashier)

  await ledger.redeem(
    {
      membershipId: tourist.membershipId,
      amount: 500,
      basisAmount: 30_000,
      idempotencyKey: idempotencyKey('report-redeem'),
      refType: 'receipt',
      refId: `rep-${randomUUID().slice(0, 8)}`,
      ...byCashier,
    },
    tourist.scope,
  )

  await earn(resident, 40_000, POS_ORIGIN)
  const voided = await earn(resident, 50_000, POS_ORIGIN)
  await ledger.reverse(
    {
      entryId: voided,
      idempotencyKey: idempotencyKey('report-void'),
      reason: 'RECEIPT_VOIDED',
      ...POS_ORIGIN,
    },
    resident.scope,
  )

  // Две оценки на чеки кассира — «пятёрка» и «четвёрка», средняя 4.5. Третья висит
  // на отменённом чеке из кассы: отменённый чек не в счёт, значит и оценка его не в счёт.
  await prisma.review.createMany({
    data: [
      { tenantId, guestId: tourist.guestId, ledgerEntryId: rated, staffId: cashierId, rating: 5 },
      {
        tenantId,
        guestId: tourist.guestId,
        ledgerEntryId: alsoRated,
        staffId: cashierId,
        rating: 4,
      },
      { tenantId, guestId: resident.guestId, ledgerEntryId: voided, staffId: null, rating: 1 },
    ],
  })

  const neighbour = await createMembershipFixture(prisma)
  await earn(neighbour, 1_000_000, POS_ORIGIN)

  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
  cashierToken = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Отчёт «Клиенты»', () => {
  it('ВСЕГО ТРИ ГОСТЯ, ДВА ПОКУПАТЕЛЯ, ТУРИСТЫ И РЕЗИДЕНТЫ — И КАЖДЫЙ ДЕНЬ ПЕРИОДА', async () => {
    const response = await get('/v1/admin/reports/customers')

    expect(response.status).toBe(200)
    const body = response.body as {
      period: string
      series: Array<{ date: string; newGuests: number; firstPurchases: number }>
    } & Record<string, unknown>

    expect(body).toMatchObject({
      period: '30d',
      total: 3,
      buyers: 2,
      buyersPct: 66.7,
      newGuests: 3,
      firstPurchases: 2,
      tourists: 2,
      residents: 1,
    })
    expect(body.series).toHaveLength(30)
    expect(body.series.at(-1)).toMatchObject({ newGuests: 3, firstPurchases: 2 })
  })
})

describe('Отчёт «Операции»', () => {
  it('ВЫРУЧКА СХОДИТСЯ С ЖУРНАЛОМ: ОТМЕНЁННЫЙ ЧЕК И ЧУЖОЕ ЗАВЕДЕНИЕ НЕ В СЧЁТ', async () => {
    const response = await get('/v1/admin/reports/operations?period=7d')

    expect(response.status).toBe(200)
    const body = response.body as {
      series: Array<{ turnover: number; purchases: number }>
    } & Record<string, unknown>

    expect(body).toMatchObject({
      period: '7d',
      turnover: 100_000,
      purchases: 4,
      averageCheck: 25_000,
      earned: 500 + 1_000 + 1_500 + 2_000,
      redeemed: 500,
      voided: 1,
    })
    expect(body.series).toHaveLength(7)
    expect(body.series.at(-1)).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
      turnover: 100_000,
      purchases: 4,
    })
  })
})

describe('Отчёт «RFM»', () => {
  it('ДЕСЯТЬ СЕГМЕНТОВ: ТУРИСТ С ТРЕМЯ ПОКУПКАМИ НА ЭТОЙ НЕДЕЛЕ — ЛОЯЛЬНЫЙ', async () => {
    const response = await get('/v1/admin/reports/rfm')

    expect(response.status).toBe(200)
    const body = response.body as {
      buyers: number
      segments: Array<{ segment: string; guests: number; purchases: number; turnover: number }>
    }

    expect(body.buyers).toBe(2)
    expect(body.segments).toHaveLength(10)
    expect(body.segments.reduce((sum, row) => sum + row.guests, 0)).toBe(2)
    expect(body.segments.find((row) => row.segment === 'LOYAL')).toMatchObject({
      guests: 1,
      purchases: 3,
      turnover: 60_000,
    })
  })

  it('СЕГМЕНТ КЛИКАЕТСЯ: СПИСОК ГОСТЕЙ С ФИЛЬТРОМ ОТДАЁТ РОВНО ЕГО ГОСТЕЙ', async () => {
    const loyal = await get('/v1/admin/guests?segment=LOYAL')

    expect(loyal.status).toBe(200)
    const body = loyal.body as { items: Array<{ membershipId: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items.map((row) => row.membershipId)).toEqual([tourist.membershipId])

    const champions = (await get('/v1/admin/guests?segment=CHAMPIONS')).body as { total: number }
    expect(champions.total).toBe(0)

    expect((await get('/v1/admin/guests?segment=VIP')).status).toBe(400)
  })
})

describe('Отчёт «Сотрудники»', () => {
  it('КАССИР — ТРИ ЧЕКА, ИХ ВЫРУЧКА, НОВЫЙ ГОСТЬ И СРЕДНЯЯ ОЦЕНКА; КАССА POSITIVE — ОТДЕЛЬНО', async () => {
    const response = await get('/v1/admin/reports/staff')

    expect(response.status).toBe(200)
    const body = response.body as {
      staff: Array<Record<string, unknown>>
      system: Record<string, unknown>
    }

    expect(body.staff).toEqual([
      {
        staffId: cashierId,
        displayName: 'Кассир Лек',
        role: 'CASHIER',
        isActive: true,
        operations: 3,
        turnover: 60_000,
        newGuests: 1,
        reviews: 2,
        rating: 4.5,
        earned: 0,
        earnedPending: 0,
      },
    ])
    // Оценка с отменённого чека не попала ни в одну строку.
    expect(body.system).toEqual({
      operations: 1,
      turnover: 40_000,
      newGuests: 1,
      reviews: 0,
      rating: null,
      earned: 0,
      earnedPending: 0,
    })
  })
})

describe('Отчёты: права и период', () => {
  it('кассиру отчёты закрыты, неизвестный период — 400', async () => {
    for (const report of ['customers', 'operations', 'rfm', 'staff']) {
      expect((await get(`/v1/admin/reports/${report}`, cashierToken)).status).toBe(403)
    }

    expect((await get('/v1/admin/reports/operations?period=1y')).status).toBe(400)
  })
})
