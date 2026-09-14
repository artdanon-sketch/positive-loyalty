import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture } from './ledger-test-context'

/**
 * Застрявшие чеки: снимок очереди планшета и список владельца.
 * docs/02, раздел 3.6 · docs/10, раздел 5.7.
 *
 * Каждый тест заводит своё заведение и свой планшет: снимки перезаписывают
 * друг друга, и общие данные сделали бы тесты зависимыми от порядка.
 */

const SECRET = 'pos-queue-secret-not-used-anywhere-else'
const HOUR_MS = 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService

interface StuckBody {
  items: Array<{
    receiptId: string
    amount: number
    guest: string | null
    terminal: string
    stuck: boolean
    lastError: string | null
  }>
}

const server = (): Server => app.getHttpServer() as Server

const sign = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET)

const report = (token: string, body: object) =>
  request(server()).put('/v1/pos/queue').set('Authorization', `Bearer ${token}`).send(body)

const stuck = async (token: string): Promise<StuckBody> =>
  (
    await request(server())
      .get('/v1/admin/stuck-receipts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  ).body as StuckBody

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()

const receipt = (label: string): string => `pos-${label}-${randomUUID().slice(0, 8)}`

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

describe('Застрявшие чеки у владельца', () => {
  it('ОТКАЗАННЫЙ СЕРВЕРОМ И ОПАЗДЫВАЮЩИЙ БОЛЬШЕ ЧАСА — У ВЛАДЕЛЬЦА; СВЕЖИЙ — НЕТ', async () => {
    const venue = await createMembershipFixture(prisma)
    const terminal = `tab-${randomUUID()}`
    const rejected = receipt('rejected')
    const late = receipt('late')
    const fresh = receipt('fresh')

    await report(sign(venue.tenantId, 'CASHIER'), {
      terminalId: terminal,
      items: [
        {
          receiptId: rejected,
          amount: 125_000,
          target: { kind: 'MEMBERSHIP', membershipId: venue.membershipId },
          attempts: 20,
          lastError: 'Номер чека обязателен',
          queuedAt: ago(5 * 60 * 1000),
        },
        {
          receiptId: late,
          amount: 40_000,
          target: { kind: 'PHONE', phone: venue.guestPhone },
          attempts: 3,
          lastError: 'Failed to fetch',
          queuedAt: ago(2 * HOUR_MS),
        },
        {
          receiptId: fresh,
          amount: 10_000,
          target: { kind: 'PHONE', phone: '+66899990000' },
          attempts: 1,
          queuedAt: ago(5 * 60 * 1000),
        },
      ],
    }).expect(200)

    const body = await stuck(sign(venue.tenantId, 'MANAGER'))
    const byId = new Map(body.items.map((item) => [item.receiptId, item]))
    const masked = `${venue.guestPhone.slice(0, 3)} •• •• ${venue.guestPhone.slice(-4)}`

    // Старые сверху: дольше всех без баллов ждёт гость первой строки.
    expect(body.items.map((item) => item.receiptId)).toEqual([late, rejected])

    expect(byId.get(rejected)).toMatchObject({
      amount: 125_000,
      stuck: true,
      lastError: 'Номер чека обязателен',
      terminal: terminal.slice(-4),
      guest: masked,
    })
    expect(byId.get(late)).toMatchObject({ stuck: false, guest: masked })
    expect(byId.has(fresh)).toBe(false)

    // На «Обзоре» — первым советом и с тем же числом, что в списке.
    const dashboard = await request(server())
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${sign(venue.tenantId, 'MANAGER')}`)
      .expect(200)

    expect((dashboard.body as { advice: Array<Record<string, unknown>> }).advice[0]).toEqual({
      kind: 'STUCK_RECEIPTS',
      receipts: 2,
    })
  })

  it('ПОЛНОГО ТЕЛЕФОНА СЕРВЕР НЕ ХРАНИТ — только маску', async () => {
    const venue = await createMembershipFixture(prisma)

    await report(sign(venue.tenantId, 'CASHIER'), {
      terminalId: `tab-${randomUUID()}`,
      items: [
        {
          receiptId: receipt('phone'),
          amount: 30_000,
          target: { kind: 'PHONE', phone: '+66811112233' },
          attempts: 20,
          queuedAt: ago(HOUR_MS),
        },
      ],
    }).expect(200)

    const rows = await prisma.posQueueItem.findMany({ where: { tenantId: venue.tenantId } })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.guestHint).toBe('+66 •• •• 2233')
    expect(JSON.stringify(rows)).not.toContain('811112233')
  })

  it('ЧЕК УШЁЛ С ПЛАНШЕТА — ПРОПАЛ И У ВЛАДЕЛЬЦА; ПУСТОЙ СНИМОК ОЧИЩАЕТ ВСЁ', async () => {
    const venue = await createMembershipFixture(prisma)
    const cashier = sign(venue.tenantId, 'CASHIER')
    const terminal = `tab-${randomUUID()}`
    const first = receipt('first')
    const second = receipt('second')

    const item = (receiptId: string) => ({
      receiptId,
      amount: 20_000,
      target: { kind: 'MEMBERSHIP', membershipId: venue.membershipId },
      attempts: 20,
      queuedAt: ago(HOUR_MS),
    })

    await report(cashier, { terminalId: terminal, items: [item(first), item(second)] }).expect(200)
    await report(cashier, { terminalId: terminal, items: [item(second)] }).expect(200)

    expect((await stuck(sign(venue.tenantId, 'OWNER'))).items.map((row) => row.receiptId)).toEqual([
      second,
    ])

    await report(cashier, { terminalId: terminal, items: [] }).expect(200)

    expect((await stuck(sign(venue.tenantId, 'OWNER'))).items).toHaveLength(0)
  })

  it('СОСЕД НЕ ВИДИТ ЧУЖИХ ЧЕКОВ И НЕ СНИМАЕТ ИХ — даже с той же меткой планшета', async () => {
    const own = await createMembershipFixture(prisma)
    const foreign = await createMembershipFixture(prisma)
    const terminal = `tab-${randomUUID()}`
    const ours = receipt('ours')

    await report(sign(own.tenantId, 'CASHIER'), {
      terminalId: terminal,
      items: [
        {
          receiptId: ours,
          amount: 50_000,
          target: { kind: 'MEMBERSHIP', membershipId: own.membershipId },
          attempts: 20,
          queuedAt: ago(HOUR_MS),
        },
      ],
    }).expect(200)

    // Сосед шлёт пустой снимок с той же меткой — наш чек это не снимает.
    await report(sign(foreign.tenantId, 'CASHIER'), { terminalId: terminal, items: [] }).expect(200)

    expect((await stuck(sign(own.tenantId, 'MANAGER'))).items.map((row) => row.receiptId)).toEqual([
      ours,
    ])
    expect(
      (await stuck(sign(foreign.tenantId, 'MANAGER'))).items.some((row) => row.receiptId === ours),
    ).toBe(false)
  })

  it('кассиру список закрыт — 403; снимок без метки — 400', async () => {
    const venue = await createMembershipFixture(prisma)

    await request(server())
      .get('/v1/admin/stuck-receipts')
      .set('Authorization', `Bearer ${sign(venue.tenantId, 'CASHIER')}`)
      .expect(403)

    await report(sign(venue.tenantId, 'CASHIER'), { items: [] }).expect(400)
  })
})
