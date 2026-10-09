import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import type { Prisma } from '../../src/generated/prisma/client'

import { createMembershipFixture, createTenant } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Процент с покупок друзей — три круга, как у UDS. docs/02, раздел 5.6.2.
 *
 * Цепочка: Аня пригласила Бориса, Борис — Веру, Вера — Гришу. Гриша покупает
 * на 1 000 ฿ деньгами — Вера получает 5 %, Борис 3 %, Аня 1 %.
 *
 *   круги            ближний первым, глубже третьего — ничего;
 *   повтор чека      тем же номером не платит второй раз;
 *   отмена чека      забирает проценты у всех кругов;
 *   контрольная      пригласивший из группы пропускается, цепочка идёт дальше;
 *   разовая награда  проценты не съедают её лимит;
 *   выключено        нули — никто ничего;
 *   сосед            цепочки не выходят за заведение.
 */

const SECRET = 'referral-levels-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

interface Chain {
  tenantId: string
  cashier: string
  owner: string
  anya: MembershipFixture
  boris: MembershipFixture
  vera: MembershipFixture
  grisha: MembershipFixture
  /** Ещё один друг Ани — проверить, что лимит разовой награды цел. */
  dasha: MembershipFixture
}

const writeSettings = async (tenantId: string, settings: Prisma.InputJsonObject): Promise<void> => {
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings } })
}

const invitedBy = async (friend: MembershipFixture, inviter: MembershipFixture): Promise<void> => {
  await prisma.membership.update({
    where: { id: friend.membershipId },
    data: { referredById: inviter.membershipId, source: 'REFERRAL' },
  })
}

const chain = async (
  referral: Record<string, unknown> = {
    enabled: true,
    reward: 0,
    limit: 1,
    levels: [5, 3, 1],
  },
): Promise<Chain> => {
  const tenantId = await createTenant(prisma)
  await writeSettings(tenantId, {
    cashierRules: { requireReceiptNumber: false },
    referral: referral as Prisma.InputJsonObject,
  })

  const anya = await createMembershipFixture(prisma, { tenantId })
  const boris = await createMembershipFixture(prisma, { tenantId })
  const vera = await createMembershipFixture(prisma, { tenantId })
  const grisha = await createMembershipFixture(prisma, { tenantId })
  const dasha = await createMembershipFixture(prisma, { tenantId })

  await invitedBy(boris, anya)
  await invitedBy(vera, boris)
  await invitedBy(grisha, vera)
  await invitedBy(dasha, anya)

  const sign = (role: string): string => signAccessToken({ tenantId, actorId: null, role }, SECRET)

  return {
    tenantId,
    cashier: sign('CASHIER'),
    owner: sign('OWNER'),
    anya,
    boris,
    vera,
    grisha,
    dasha,
  }
}

let receiptSeq = 0

const sell = async (
  place: Chain,
  buyer: MembershipFixture,
  amount: number,
  receiptId = `lvl-${String(Date.now())}-${String((receiptSeq += 1))}`,
): Promise<{ transactionId: string; receiptId: string }> => {
  const preview = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${place.cashier}`)
    .send({ membershipId: buyer.membershipId, amount })
    .expect(200)

  const commit = await request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${place.cashier}`)
    .send({ previewId: (preview.body as { previewId: string }).previewId, receiptId })
    .expect(200)

  return { transactionId: (commit.body as { transactionId: string }).transactionId, receiptId }
}

const balance = async (fixture: MembershipFixture): Promise<number> =>
  (
    await prisma.membership.findUniqueOrThrow({
      where: { id: fixture.membershipId },
      select: { pointsBalance: true },
    })
  ).pointsBalance

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

describe('Процент с покупок друзей: три круга', () => {
  it('ГРИША КУПИЛ НА 1 000 ฿ — ВЕРЕ 5 %, БОРИСУ 3 %, АНЕ 1 %; ПОВТОР ЧЕКА НЕ ПЛАТИТ ДВАЖДЫ', async () => {
    const place = await chain()

    const sale = await sell(place, place.grisha, 100_000)

    expect(await balance(place.vera)).toBe(5_000)
    expect(await balance(place.boris)).toBe(3_000)
    expect(await balance(place.anya)).toBe(1_000)

    // Повтор проведения тем же номером чека — первый ответ, процентов не прибавилось.
    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set('Authorization', `Bearer ${place.cashier}`)
      .send({ membershipId: place.grisha.membershipId, amount: 100_000 })
      .expect(200)
    const replay = await request(server())
      .post('/v1/pos/transactions/commit')
      .set('Authorization', `Bearer ${place.cashier}`)
      .send({
        previewId: (preview.body as { previewId: string }).previewId,
        receiptId: sale.receiptId,
      })
      .expect(200)
    expect((replay.body as { replayed: boolean }).replayed).toBe(true)

    expect(await balance(place.vera)).toBe(5_000)
    expect(await balance(place.anya)).toBe(1_000)

    const shares = await prisma.ledgerEntry.findMany({
      where: { tenantId: place.tenantId, refType: 'referral', refId: sale.receiptId },
      select: { membershipId: true, type: true },
    })
    expect(shares).toHaveLength(3)
    expect(shares.every((row) => row.type === 'GRANT')).toBe(true)
  })

  it('ОТМЕНА ЧЕКА ЗАБИРАЕТ ПРОЦЕНТЫ У ВСЕХ ТРЁХ КРУГОВ', async () => {
    const place = await chain()

    const sale = await sell(place, place.grisha, 100_000)
    await request(server())
      .post(`/v1/pos/transactions/${sale.transactionId}/void`)
      .set('Authorization', `Bearer ${place.cashier}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    expect(await balance(place.vera)).toBe(0)
    expect(await balance(place.boris)).toBe(0)
    expect(await balance(place.anya)).toBe(0)

    // Повтор отмены ничего не ломает и второй компенсации не пишет.
    await request(server())
      .post(`/v1/pos/transactions/${sale.transactionId}/void`)
      .set('Authorization', `Bearer ${place.cashier}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    const reversals = await prisma.ledgerEntry.count({
      where: { tenantId: place.tenantId, refType: 'referral', type: 'REVERSAL' },
    })
    expect(reversals).toBe(3)
  })

  it('ПОКУПКА БОРИСА ПЛАТИТ ТОЛЬКО АНЕ: ВЫШЕ НЕЁ НИКОГО', async () => {
    const place = await chain()

    await sell(place, place.boris, 200_000)

    expect(await balance(place.anya)).toBe(10_000)
    expect(await balance(place.vera)).toBe(0)
  })

  it('ПРИГЛАСИВШИЙ ИЗ КОНТРОЛЬНОЙ ГРУППЫ ПРОПУСКАЕТСЯ, ЦЕПОЧКА ИДЁТ ДАЛЬШЕ', async () => {
    const place = await chain()
    await prisma.membership.update({
      where: { id: place.boris.membershipId },
      data: { isControlGroup: true },
    })

    await sell(place, place.grisha, 100_000)

    expect(await balance(place.vera)).toBe(5_000)
    expect(await balance(place.boris)).toBe(0)
    expect(await balance(place.anya)).toBe(1_000)
  })

  it('ПОКУПАТЕЛЬ ИЗ КОНТРОЛЬНОЙ ГРУППЫ НИКОМУ НИЧЕГО НЕ ПРИНОСИТ', async () => {
    const place = await chain()
    await prisma.membership.update({
      where: { id: place.grisha.membershipId },
      data: { isControlGroup: true },
    })

    await sell(place, place.grisha, 100_000)

    expect(await balance(place.vera)).toBe(0)
    expect(await balance(place.anya)).toBe(0)
  })

  it('ПРОЦЕНТЫ НЕ СЪЕДАЮТ ЛИМИТ РАЗОВОЙ НАГРАДЫ', async () => {
    // Разовая награда 50 ฿, лимит — один друг. Борис покупает впервые — Ане
    // разовая награда и 5 %; Даша покупает впервые — лимит исчерпан, но
    // процент с её покупки Аня получает.
    const place = await chain({ enabled: true, reward: 5_000, limit: 1, levels: [5, 0, 0] })

    await sell(place, place.boris, 100_000)
    expect(await balance(place.anya)).toBe(10_000)

    await sell(place, place.dasha, 100_000)
    expect(await balance(place.anya)).toBe(15_000)

    const referral = await request(server())
      .get(`/v1/admin/guests/${place.anya.guestId}`)
      .set('Authorization', `Bearer ${place.owner}`)
      .expect(200)
    expect((referral.body as { referral: { rewarded: number } }).referral.rewarded).toBe(1)
  })

  it('ВЫКЛЮЧЕНО ИЛИ НУЛИ — НИКТО НИЧЕГО; СТАРЫЕ НАСТРОЙКИ БЕЗ ПРОЦЕНТОВ — ТОЖЕ', async () => {
    for (const referral of [
      { enabled: false, reward: 0, limit: 1, levels: [5, 3, 1] },
      { enabled: true, reward: 5_000, limit: 1, levels: [0, 0, 0] },
      { enabled: true, reward: 5_000, limit: 1 },
    ]) {
      const place = await chain(referral)

      await sell(place, place.grisha, 100_000)

      // Разовая награда Вере за первую покупку Гриши положена и без процентов —
      // а процентов не должно быть ни у кого.
      const shares = await prisma.ledgerEntry.count({
        where: {
          tenantId: place.tenantId,
          refType: 'referral',
          idempotencyKey: { startsWith: 'referral-share:' },
        },
      })
      expect(shares).toBe(0)
      expect(await balance(place.boris)).toBe(0)
    }
  })

  it('ВЛАДЕЛЕЦ СОХРАНЯЕТ ПРОЦЕНТЫ, СТАРЫЙ ЭКРАН БЕЗ НИХ ИХ НЕ СБРАСЫВАЕТ', async () => {
    const place = await chain({ enabled: false, reward: 0, limit: 10 })

    const saved = await request(server())
      .put('/v1/admin/settings/program/referral')
      .set('Authorization', `Bearer ${place.owner}`)
      .send({ enabled: true, reward: 0, limit: 10, levels: [5, 3, 1] })
      .expect(200)
    expect((saved.body as { levels: number[] }).levels).toEqual([5, 3, 1])

    const kept = await request(server())
      .put('/v1/admin/settings/program/referral')
      .set('Authorization', `Bearer ${place.owner}`)
      .send({ enabled: true, reward: 5_000, limit: 10 })
      .expect(200)
    expect((kept.body as { levels: number[] }).levels).toEqual([5, 3, 1])

    // Включено, но ничего не даёт, — отказ.
    await request(server())
      .put('/v1/admin/settings/program/referral')
      .set('Authorization', `Bearer ${place.owner}`)
      .send({ enabled: true, reward: 0, limit: 10, levels: [0, 0, 0] })
      .expect(400)
  })

  it('ЦЕПОЧКА НЕ ВЫХОДИТ ЗА ЗАВЕДЕНИЕ: ЧУЖОЙ «ПРИГЛАСИВШИЙ» НИЧЕГО НЕ ПОЛУЧАЕТ', async () => {
    const place = await chain()
    const neighbour = await chain()

    // Ссылка на участие соседа — подделка, которой в живой базе не бывает.
    await prisma.membership.update({
      where: { id: place.anya.membershipId },
      data: { referredById: neighbour.vera.membershipId },
    })

    await sell(place, place.boris, 100_000)

    expect(await balance(place.anya)).toBe(5_000)
    expect(await balance(neighbour.vera)).toBe(0)
  })
})
