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
 * Номер чека придумывает касса заведения — у разных заведений он совпадает.
 * Раньше ключ журнала был `pos:earn:<номер>` на всю базу, и чек «42» мог
 * провести только первое заведение, второе получало 500 (прогон 13.11.2026).
 */

const SECRET = 'pos-receipt-keys-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

const venue = async (): Promise<{ tenantId: string; cashier: string }> => {
  const tenantId = await createTenant(prisma)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { baseEarnRate: 10, cashierRules: { requireReceiptNumber: false } } },
  })
  return {
    tenantId,
    cashier: signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET, 3600),
  }
}

const sale = async (
  cashier: string,
  membershipId: string,
  receiptId: string,
): Promise<request.Response> => {
  const preview = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${cashier}`)
    .send({ membershipId, amount: 100_000, redeemRequested: 0 })
    .expect(200)

  return request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${cashier}`)
    .send({ previewId: (preview.body as { previewId: string }).previewId, receiptId })
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
})

afterAll(async () => {
  await app.close()
})

describe('Номер чека — в рамках заведения', () => {
  it('ДВА ЗАВЕДЕНИЯ ПРОВОДЯТ ЧЕК С ОДНИМ НОМЕРОМ — ОБА ГОСТЯ ПОЛУЧАЮТ БАЛЛЫ', async () => {
    const a = await venue()
    const b = await venue()
    const guestA = await createMembershipFixture(prisma, { tenantId: a.tenantId })
    const guestB = await createMembershipFixture(prisma, { tenantId: b.tenantId })
    const shared = `42-${Date.now()}`

    const first = await sale(a.cashier, guestA.membershipId, shared)
    const second = await sale(b.cashier, guestB.membershipId, shared)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ replayed: false, earned: 10_000, newBalance: 10_000 })
  })

  it('ПОВТОР ЧЕКА В ТОМ ЖЕ ЗАВЕДЕНИИ ПО-ПРЕЖНЕМУ НЕ НАЧИСЛЯЕТ ДВАЖДЫ', async () => {
    const a = await venue()
    const guest = await createMembershipFixture(prisma, { tenantId: a.tenantId })
    const id = `7-${Date.now()}`

    await sale(a.cashier, guest.membershipId, id).then((response) =>
      expect(response.status).toBe(200),
    )
    const again = await sale(a.cashier, guest.membershipId, id)

    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ replayed: true, newBalance: 10_000 })
  })
})
