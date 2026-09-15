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
  idempotencyKey,
  POS_ORIGIN,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * «Сегодня». docs/02, раздел 5.1.2 · docs/11, У11.
 *
 * Полигон: два гостя заведения. Сегодня — два чека, третий отменён; чек трёхдневной
 * давности; списание баллами по сегодняшнему чеку. У соседнего заведения — свой чек,
 * он не должен попасть в наши цифры.
 */

const SECRET = 'today-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let first: MembershipFixture
let second: MembershipFixture
let neighbour: MembershipFixture
let managerToken: string
let cashierToken: string

const server = (): Server => app.getHttpServer() as Server

interface TodayBody {
  date: string
  revenue: number
  purchases: number
  avgCheck: number | null
  buyers: number
  newGuests: number
  totalGuests: number
  pointsEarned: number
  pointsRedeemed: number
  voided: number
  setup: Array<{ step: string; done: boolean }>
}

const today = (token: string) =>
  request(server()).get('/v1/admin/today').set('Authorization', `Bearer ${token}`)

const receipt = async (
  fixture: MembershipFixture,
  basisAmount: number,
  amount: number,
  occurredAt?: Date,
): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId: fixture.membershipId,
      amount,
      basisAmount,
      idempotencyKey: idempotencyKey('today-check'),
      refType: 'receipt',
      refId: `td-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
      ...(occurredAt === undefined ? {} : { occurredAt: occurredAt.toISOString() }),
    },
    { tenantId: fixture.tenantId },
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

  first = await createMembershipFixture(prisma)
  second = await createMembershipFixture(prisma, { tenantId: first.tenantId })
  neighbour = await createMembershipFixture(prisma)

  await receipt(first, 40_000, 2_000)
  await receipt(second, 60_000, 3_000)
  await receipt(first, 99_000, 500, new Date(Date.now() - 3 * DAY_MS))

  const voided = await receipt(first, 30_000, 1_500)
  await ledger.reverse(
    {
      entryId: voided,
      idempotencyKey: idempotencyKey('today-void'),
      reason: 'RECEIPT_VOIDED',
      ...POS_ORIGIN,
    },
    { tenantId: first.tenantId },
  )

  await ledger.redeem(
    {
      membershipId: first.membershipId,
      amount: 1_000,
      basisAmount: 40_000,
      idempotencyKey: idempotencyKey('today-redeem'),
      refType: 'receipt',
      refId: `td-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    { tenantId: first.tenantId },
  )

  await receipt(neighbour, 77_000, 3_850)

  const sign = (role: string): string =>
    signAccessToken({ tenantId: first.tenantId, actorId: null, role }, SECRET)

  managerToken = sign('MANAGER')
  cashierToken = sign('CASHIER')
})

afterAll(async () => {
  await app.close()
})

describe('Сегодня', () => {
  it('ЦИФРЫ ДНЯ: ОТМЕНЁННЫЙ И ВЧЕРАШНИЕ ЧЕКИ НЕ В СЧЁТ, СОСЕДИ — ТОЖЕ', async () => {
    const response = await today(managerToken)

    expect(response.status).toBe(200)
    const body = response.body as TodayBody

    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body).toMatchObject({
      revenue: 100_000,
      purchases: 2,
      avgCheck: 50_000,
      buyers: 2,
      pointsEarned: 5_000,
      pointsRedeemed: 1_000,
      voided: 1,
      // Оба участия заведены сегодня — тем же днём, что и полигон.
      newGuests: 2,
      totalGuests: 2,
    })
  })

  it('НОВОЕ ЗАВЕДЕНИЕ: ВСЕ ЧЕТЫРЕ ШАГА НАСТРОЙКИ ЖДУТ; СДЕЛАННЫЙ ШАГ ОТМЕЧАЕТСЯ', async () => {
    const before = (await today(managerToken)).body as TodayBody
    expect(before.setup).toEqual([
      { step: 'PROGRAM', done: false },
      { step: 'CASHIER', done: false },
      { step: 'OFFER', done: false },
      { step: 'CHANNEL', done: false },
    ])

    const tenantId = first.tenantId

    await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { baseEarnRate: 5 } } })
    await prisma.staff.create({ data: { tenantId, displayName: 'Нок', role: 'CASHIER' } })
    await prisma.offer.create({
      data: {
        tenantId,
        type: 'CASHBACK',
        status: 'LIVE',
        audience: {},
        schedule: {},
        limits: {},
        reward: {},
        i18n: {},
      },
    })
    await prisma.acquisitionChannel.create({
      data: { tenantId, name: 'Табличка', code: randomUUID().slice(0, 8).toUpperCase() },
    })

    const after = (await today(managerToken)).body as TodayBody
    expect(after.setup.every((item) => item.done)).toBe(true)
  })

  it('кассиру «Сегодня» не показывается', async () => {
    expect((await today(cashierToken)).status).toBe(403)
  })
})
