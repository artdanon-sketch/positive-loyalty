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
 * Частичный возврат чека. Решение владельца 17.11.2026: «Пересчитывать сами».
 *
 * Касса присылает НАКОПЛЕННЫЕ суммы возврата по чеку; сервис дописывает в журнал
 * разницу. Здесь проверено то, ради чего так сделано: повтор и опоздавший
 * старый возврат ничего не задваивают, а полная отмена после частичного
 * возвращает гостя ровно туда, где он был до чека.
 */

const SECRET = 'pos-refund-part-secret-not-used-anywhere-else'

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

type Refund = {
  pointsReturned: number
  pointsTakenBack: number
  totalReturned: number
  totalTakenBack: number
  newBalance: number
  replayed: boolean
}

const setup = async () => {
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
  // Возвраты присылает сервер кассы — его токен и проверяем.
  const link = signAccessToken({ tenantId, actorId: null, role: 'POS_LINK' }, SECRET, 3600)
  const guest = await createMembershipFixture(prisma, { tenantId })

  const pos = (path: string, body: object, token = link) =>
    request(server()).post(path).set('Authorization', `Bearer ${token}`).send(body)

  const sale = async (amount: number, redeemRequested: number) => {
    const preview = await pos('/v1/pos/transactions/preview', {
      membershipId: guest.membershipId,
      amount,
      redeemRequested,
    }).expect(200)
    const commit = await pos('/v1/pos/transactions/commit', {
      previewId: (preview.body as { previewId: string }).previewId,
      receiptId: `r-${Math.random().toString(36).slice(2)}`,
    }).expect(200)
    return commit.body as { transactionId: string; earned: number; redeemed: number }
  }

  const refund = (
    transactionId: string,
    refundId: string,
    refundedMoney: number,
    refundedPoints: number,
  ) =>
    pos(`/v1/pos/transactions/${transactionId}/refund`, { refundId, refundedMoney, refundedPoints })

  return { tenantId, guest, pos, sale, refund }
}

describe('Частичный возврат чека', () => {
  it('ВОЗВРАЩАЕТ ДОЛЮ ОПЛАТЫ БАЛЛАМИ И СНИМАЕТ ДОЛЮ НАЧИСЛЕННОГО; ПОВТОР НИЧЕГО НЕ ЗАДВАИВАЕТ', async () => {
    const { guest, sale, refund } = await setup()

    // Первый чек даёт гостю баллы, второй платит ими часть.
    await sale(200_000, 0)
    const check = await sale(100_000, 10_000)
    expect(check.redeemed).toBe(10_000)
    const earned = check.earned
    expect(earned).toBeGreaterThan(0)
    const before = await readBalance(prisma, guest.membershipId)

    // Вернули блюдо на половину чека: 450 ฿ деньгами и 50 ฿ баллами.
    const first = await refund(check.transactionId, 'refund-1', 45_000, 5_000)
    expect(first.status).toBe(200)
    const body = first.body as Refund
    expect(body.pointsReturned).toBe(5_000)
    expect(body.pointsTakenBack).toBe(Math.round(earned / 2))
    expect(body.replayed).toBe(false)
    expect(await readBalance(prisma, guest.membershipId)).toBe(
      before + 5_000 - Math.round(earned / 2),
    )

    // Касса повторила тот же возврат — журнал не меняется.
    const again = await refund(check.transactionId, 'refund-1', 45_000, 5_000)
    expect(again.status).toBe(200)
    expect((again.body as Refund).replayed).toBe(true)
    expect((again.body as Refund).pointsReturned).toBe(0)
    expect(await readBalance(prisma, guest.membershipId)).toBe(body.newBalance)
    expect(await readLedgerSum(prisma, guest.membershipId)).toBe(body.newBalance)
  })

  it('ОПОЗДАВШИЙ СТАРЫЙ ВОЗВРАТ ПОСЛЕ НОВОГО НЕ ДОПИСЫВАЕТ НИЧЕГО', async () => {
    const { guest, sale, refund } = await setup()
    await sale(200_000, 0)
    const check = await sale(100_000, 10_000)

    // Второй возврат (накопленно 60%) дошёл раньше первого (30%).
    const later = await refund(check.transactionId, 'refund-2', 54_000, 6_000)
    expect(later.status).toBe(200)
    const afterLater = await readBalance(prisma, guest.membershipId)

    const late = await refund(check.transactionId, 'refund-1', 27_000, 3_000)
    expect(late.status).toBe(200)
    expect((late.body as Refund).replayed).toBe(true)
    expect(await readBalance(prisma, guest.membershipId)).toBe(afterLater)
  })

  it('ПОЛНАЯ ОТМЕНА ПОСЛЕ ЧАСТИЧНОГО ВОЗВРАТА ВОЗВРАЩАЕТ ГОСТЯ К БАЛАНСУ ДО ЧЕКА', async () => {
    const { guest, sale, refund, pos } = await setup()
    await sale(200_000, 0)
    const beforeCheck = await readBalance(prisma, guest.membershipId)
    const check = await sale(100_000, 10_000)

    await refund(check.transactionId, 'refund-1', 45_000, 5_000).expect(200)

    const voided = await pos(`/v1/pos/transactions/${check.transactionId}/void`, {
      reason: 'REFUND',
      comment: 'Возврат чека на кассе',
    })
    expect(voided.status).toBe(200)
    expect(await readBalance(prisma, guest.membershipId)).toBe(beforeCheck)
    expect(await readLedgerSum(prisma, guest.membershipId)).toBe(beforeCheck)

    // Повтор отмены возвращает прежний результат, а не дописывает.
    const voidAgain = await pos(`/v1/pos/transactions/${check.transactionId}/void`, {
      reason: 'REFUND',
      comment: 'Возврат чека на кассе',
    })
    expect(voidAgain.status).toBe(200)
    expect((voidAgain.body as { replayed: boolean }).replayed).toBe(true)

    // Частичный возврат по отменённому чеку — отказ, а не тихий ноль.
    const lateRefund = await refund(check.transactionId, 'refund-2', 90_000, 10_000)
    expect(lateRefund.status).toBe(409)
    expect(await readBalance(prisma, guest.membershipId)).toBe(beforeCheck)
  })

  it('СНИМАЕТ НАЧИСЛЕННОЕ, ДАЖЕ ЕСЛИ ГОСТЬ ЕГО УЖЕ ПОТРАТИЛ: БАЛАНС УХОДИТ В МИНУС', async () => {
    const { guest, sale, refund } = await setup()
    const check = await sale(100_000, 0)
    // Всё начисленное потрачено следующим чеком.
    await sale(100_000, check.earned)
    expect(await readBalance(prisma, guest.membershipId)).toBeGreaterThanOrEqual(0)

    const res = await refund(check.transactionId, 'refund-1', 100_000, 0)
    expect(res.status).toBe(200)
    expect((res.body as Refund).pointsTakenBack).toBe(check.earned)
    expect(await readLedgerSum(prisma, guest.membershipId)).toBe(
      await readBalance(prisma, guest.membershipId),
    )
  })

  it('ВОЗВРАТ НА НОЛЬ — 400; ЧУЖОЕ ЗАВЕДЕНИЕ ЧЕКА НЕ ВИДИТ — 404', async () => {
    const { sale, refund, pos } = await setup()
    const check = await sale(100_000, 0)

    const zero = await refund(check.transactionId, 'refund-0', 0, 0)
    expect(zero.status).toBe(400)

    const other = await createTenant(prisma)
    const stranger = signAccessToken(
      { tenantId: other, actorId: null, role: 'POS_LINK' },
      SECRET,
      3600,
    )
    const foreign = await pos(
      `/v1/pos/transactions/${check.transactionId}/refund`,
      { refundId: 'x', refundedMoney: 10_000, refundedPoints: 0 },
      stranger,
    )
    expect(foreign.status).toBe(404)
  })
})
