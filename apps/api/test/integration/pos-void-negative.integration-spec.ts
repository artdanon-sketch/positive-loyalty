import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  createTenant,
  readBalance,
  readLedgerSum,
} from './ledger-test-context'

/**
 * Отмена чека, баллы которого гость уже потратил. Решение владельца 13.11.2026
 * (docs/05, раздел 6.6): отмена проводится, баланс уходит в минус. Раньше
 * касса получала 500 посреди отмены, когда промокоды чека уже аннулированы.
 */

const SECRET = 'pos-void-negative-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

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

describe('Отмена чека с уже потраченными баллами', () => {
  it('КАССА ОТМЕНЯЕТ ЧЕК, БАЛАНС ГОСТЯ УХОДИТ В МИНУС И СХОДИТСЯ С ЖУРНАЛОМ', async () => {
    const tenantId = await createTenant(prisma)
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          baseEarnRate: 10,
          baseRedeemRate: 20,
          cashierRules: { requireReceiptNumber: false },
        },
      },
    })
    const cashier = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET, 3600)
    const guest = await createMembershipFixture(prisma, { tenantId })

    const pos = (path: string, body: object) =>
      request(server()).post(path).set('Authorization', `Bearer ${cashier}`).send(body)

    const sale = async (amount: number, redeemRequested: number, receiptId: string) => {
      const preview = await pos('/v1/pos/transactions/preview', {
        membershipId: guest.membershipId,
        amount,
        redeemRequested,
      }).expect(200)
      const commit = await pos('/v1/pos/transactions/commit', {
        previewId: (preview.body as { previewId: string }).previewId,
        receiptId,
      }).expect(200)
      return commit.body as { transactionId: string; newBalance: number }
    }

    // Чек на 1 000 ฿ даёт 100 ฿ баллами, второй чек тратит их целиком.
    const first = await sale(100_000, 0, `first-${Date.now()}`)
    await sale(100_000, 10_000, `second-${Date.now()}`)
    const before = await readBalance(prisma, guest.membershipId)

    const voided = await pos(`/v1/pos/transactions/${first.transactionId}/void`, {
      reason: 'RECEIPT_VOIDED',
    })

    expect(voided.status).toBe(200)
    expect(await readBalance(prisma, guest.membershipId)).toBe(before - 10_000)
    expect(await readBalance(prisma, guest.membershipId)).toBeLessThan(0)
    expect(await readLedgerSum(prisma, guest.membershipId)).toBe(
      await readBalance(prisma, guest.membershipId),
    )
  })
})
