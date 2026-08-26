import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture } from './ledger-test-context'

/**
 * Отмена чека с кассы. docs/02, раздел 3.5.
 *
 * Окно кассира проверяется подменой системного времени, а не ожиданием
 * шестнадцати минут: журнал append-only, состарить запись в базе нельзя
 * по построению — значит, старим часы процесса.
 */

const SECRET = 'pos-void-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let cashierToken: string
let managerToken: string

const server = (): Server => app.getHttpServer() as Server

interface PreviewBody {
  previewId: string
}

interface CommitBody {
  transactionId: string
  earned: number
  redeemed: number
  newBalance: number
}

interface VoidBody {
  transactionId: string
  reversals: Array<{ entryId: string; reversalId: string; amount: number }>
  newBalance: number
  replayed: boolean
}

/** Полный путь чека: предрасчёт и проведение. Возвращает результат коммита. */
const ringUp = async (
  membershipId: string,
  amount: number,
  redeemRequested = 0,
): Promise<CommitBody> => {
  const preview = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({ membershipId, amount, redeemRequested })
    .expect(200)

  const commit = await request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({
      previewId: (preview.body as PreviewBody).previewId,
      receiptId: `void-spec-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    })
    .expect(200)

  return commit.body as CommitBody
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

  const fixture = await createMembershipFixture(prisma)
  tenantId = fixture.tenantId

  // 10% начисления, до 50% чека баллами — чтобы чек со списанием был возможен.
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        baseEarnRate: 10,
        baseRedeemRate: 50,
        cashierRules: { requireReceiptNumber: false },
      },
    },
  })

  // Сутки, а не боевые 15 минут: тесты окна отмены сдвигают часы процесса
  // вперёд, и токен со стандартным TTL просрочился бы раньше, чем проверка
  // окна, — тест мерил бы не то (401 вместо 403).
  const DAY = 24 * 60 * 60
  cashierToken = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET, DAY)
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET, DAY)
}, 60_000)

afterAll(async () => {
  await app.close()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Отмена чека', () => {
  it('кассир отменяет свежий чек: баллы возвращаются, счётчики откатываются', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const committed = await ringUp(fixture.membershipId, 100_000)
    expect(committed.newBalance).toBe(10_000)

    const before = await prisma.membership.findFirstOrThrow({
      where: { id: fixture.membershipId },
    })
    expect(before.visitsTotal).toBe(1)

    const response = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    const body = response.body as VoidBody
    expect(body.newBalance).toBe(0)
    expect(body.replayed).toBe(false)
    expect(body.reversals).toHaveLength(1)
    expect(body.reversals[0]!.amount).toBe(-10_000)

    // Счётчики участия откатились вместе с балансом.
    const after = await prisma.membership.findFirstOrThrow({
      where: { id: fixture.membershipId },
    })
    expect(after.pointsBalance).toBe(0)
    expect(after.visitsTotal).toBe(0)
    expect(after.spentTotal).toBe(0)
  })

  it('повтор отмены возвращает прежний результат и не создаёт вторых компенсаций', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const committed = await ringUp(fixture.membershipId, 200_000)

    const first = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    const second = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    const firstBody = first.body as VoidBody
    const secondBody = second.body as VoidBody

    expect(secondBody.replayed).toBe(true)
    expect(secondBody.reversals[0]!.reversalId).toBe(firstBody.reversals[0]!.reversalId)

    const reversalCount = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.count({
        where: { tenantId, membershipId: fixture.membershipId, type: 'REVERSAL' },
      }),
    )
    expect(reversalCount).toBe(1)
  })

  it('чек со списанием отменяется парой компенсаций и баланс сходится', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    // Накопить: 10% от 4000 ฿ = 400 ฿ баллов.
    await ringUp(fixture.membershipId, 400_000)
    // Чек с частичной оплатой баллами: списание 300 ฿, начисление с остатка.
    const committed = await ringUp(fixture.membershipId, 100_000, 30_000)
    expect(committed.redeemed).toBe(30_000)
    expect(committed.earned).toBe(7_000)

    const balanceBeforeVoid = committed.newBalance

    const response = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'RECEIPT_VOIDED' })
      .expect(200)

    const body = response.body as VoidBody
    expect(body.reversals).toHaveLength(2)
    // Отмена возвращает списанное и забирает начисленное: +30000 и −7000.
    expect(body.newBalance).toBe(balanceBeforeVoid + 30_000 - 7_000)
  })

  it('после пятнадцати минут кассиру отказано с VOID_WINDOW_EXPIRED', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const committed = await ringUp(fixture.membershipId, 100_000)

    // Старим часы процесса, а не запись: журнал append-only, createdAt
    // в базе не правится по построению. shouldAdvanceTime оставляет живыми
    // таймеры пула соединений — без него запросы к базе зависают.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.now() + 16 * 60_000)

    const response = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(403)

    expect(JSON.stringify(response.body)).toMatch(/VOID_WINDOW_EXPIRED/)
  })

  it('менеджер после окна отменяет, но только с комментарием', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const committed = await ringUp(fixture.membershipId, 100_000)

    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.now() + 60 * 60_000)

    // Без комментария — отказ: бессрочная отмена без объяснения неотличима
    // от заметания следов.
    const refused = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reason: 'STAFF_ERROR' })
      .expect(400)
    expect(JSON.stringify(refused.body)).toMatch(/COMMENT_REQUIRED/)

    const accepted = await request(server())
      .post(`/v1/pos/transactions/${committed.transactionId}/void`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reason: 'STAFF_ERROR', comment: 'пробили 1200 вместо 120, гость на кассе' })
      .expect(200)

    expect((accepted.body as VoidBody).newBalance).toBe(0)
  })

  it('чужой transactionId отдаёт 404 — как несуществующий', async () => {
    const foreign = await createMembershipFixture(prisma)
    const foreignCommitted = await (async () => {
      const foreignCashier = signAccessToken(
        { tenantId: foreign.tenantId, actorId: null, role: 'CASHIER' },
        SECRET,
        24 * 60 * 60,
      )
      const preview = await request(server())
        .post('/v1/pos/transactions/preview')
        .set('Authorization', `Bearer ${foreignCashier}`)
        // У чужого тенанта настройки по умолчанию: номер чека обязателен.
        .send({ membershipId: foreign.membershipId, amount: 50_000, receiptNumber: 'F-1' })
        .expect(200)
      const commit = await request(server())
        .post('/v1/pos/transactions/commit')
        .set('Authorization', `Bearer ${foreignCashier}`)
        .send({
          previewId: (preview.body as PreviewBody).previewId,
          receiptId: `void-foreign-${Date.now()}`,
        })
        .expect(200)
      return commit.body as CommitBody
    })()

    await request(server())
      .post(`/v1/pos/transactions/${foreignCommitted.transactionId}/void`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(404)
  })
})
