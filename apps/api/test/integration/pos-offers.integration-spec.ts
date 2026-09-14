import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import type { Prisma } from '../../src/generated/prisma/client'

import { createMembershipFixture } from './ledger-test-context'

/**
 * Акции на кассе: движок правил в предрасчёте и промокод за чек.
 * docs/02, разделы 3.2–3.5 · docs/06, срез 3.
 *
 * Проверка среза дословно: «200 ฿ на завтра» за чек 900 ฿ — код, который
 * гасится на кассе. Акции заводятся в базе: конструктора ещё нет (Б6).
 *
 * Каждый тест — своё заведение: акции общие на заведение, и соседние тесты
 * иначе видели бы чужие.
 */

const SECRET = 'pos-offers-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

const RETURN_TOMORROW: Prisma.InputJsonObject = {
  kind: 'GIFT_CODE',
  gift: { kind: 'FIXED_OFF', amount: 20_000 },
  validityDays: 1,
}

interface Till {
  tenantId: string
  membershipId: string
  guestId: string
  token: string
}

interface PreviewBody {
  previewId: string
  pointsToEarn: number
  appliedOffers: unknown[]
  skippedOffers: Array<{ offerId: string; reason: string; message: string }>
}

interface CommitBody {
  transactionId: string
  earned: number
  replayed: boolean
  grantsIssued: Array<{ grantId: string; offerId: string; title: string | null; codeTail: string }>
}

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

/** Заведение с базовой ставкой 10% и кассиром на смене. */
const openTill = async (): Promise<Till> => {
  const fixture = await createMembershipFixture(prisma)

  await prisma.tenant.update({
    where: { id: fixture.tenantId },
    data: {
      settings: {
        baseEarnRate: 10,
        baseRedeemRate: 20,
        cashierRules: { requireReceiptNumber: false },
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

  return {
    tenantId: fixture.tenantId,
    membershipId: fixture.membershipId,
    guestId: fixture.guestId,
    token: signAccessToken(
      { tenantId: fixture.tenantId, actorId: staff.id, role: 'CASHIER' },
      SECRET,
    ),
  }
}

const createOffer = async (
  till: Till,
  data: {
    type: 'CASHBACK' | 'PROMO_ON_CHECK'
    title: string
    priority?: number
    status?: 'LIVE' | 'PAUSED'
    limits?: Prisma.InputJsonObject
    reward: Prisma.InputJsonObject
  },
): Promise<string> => {
  const offer = await prisma.offer.create({
    data: {
      tenantId: till.tenantId,
      type: data.type,
      status: data.status ?? 'LIVE',
      priority: data.priority ?? 100,
      stackable: true,
      visibility: 'VENUE_ONLY',
      audience: { kind: 'ALL' },
      schedule: {},
      limits: data.limits ?? {},
      reward: data.reward,
      i18n: { title: { ru: data.title } },
    },
    select: { id: true },
  })

  return offer.id
}

const preview = async (till: Till, amount: number, membershipId = till.membershipId) =>
  (
    await request(server())
      .post('/v1/pos/transactions/preview')
      .set('Authorization', `Bearer ${till.token}`)
      .send({ membershipId, amount })
      .expect(200)
  ).body as PreviewBody

const commit = async (till: Till, previewId: string, receiptId: string) =>
  (
    await request(server())
      .post('/v1/pos/transactions/commit')
      .set('Authorization', `Bearer ${till.token}`)
      .send({ previewId, receiptId })
      .expect(200)
  ).body as CommitBody

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

describe('Акции на кассе', () => {
  it('ПРОВЕРКА СРЕЗА 3: «ВЕРНЁМ 200 ฿» ЗА ЧЕК 900 ฿ — КОД ПОСЛЕ ОПЛАТЫ, И ОН ГАСИТСЯ', async () => {
    const till = await openTill()
    const cashbackId = await createOffer(till, {
      type: 'CASHBACK',
      title: 'Кэшбэк 5%',
      priority: 10,
      reward: { kind: 'EARN_PERCENT', percent: 5 },
    })
    const promoId = await createOffer(till, {
      type: 'PROMO_ON_CHECK',
      title: 'Вернём 200 ฿',
      priority: 20,
      limits: { minCheck: 80_000, perGuestQty: 1 },
      reward: RETURN_TOMORROW,
    })
    await createOffer(till, {
      type: 'CASHBACK',
      title: 'На паузе',
      status: 'PAUSED',
      reward: { kind: 'EARN_PERCENT', percent: 50 },
    })

    // Соседнее заведение со своей акцией: эта касса её не видит.
    const neighbour = await openTill()
    const foreignId = await createOffer(neighbour, {
      type: 'CASHBACK',
      title: 'Чужой кэшбэк',
      reward: { kind: 'EARN_PERCENT', percent: 30 },
    })

    const counted = await preview(till, 90_000)

    expect(counted.appliedOffers).toEqual([
      {
        offerId: cashbackId,
        title: 'Кэшбэк 5%',
        earnDelta: 4_500,
        discountDelta: 0,
        grantAfterPayment: false,
      },
      {
        offerId: promoId,
        title: 'Вернём 200 ฿',
        earnDelta: 0,
        discountDelta: 0,
        grantAfterPayment: true,
      },
    ])
    expect(counted.skippedOffers).toEqual([])
    // 10% базовой ставки и 5% кэшбэка от 900 ฿.
    expect(counted.pointsToEarn).toBe(13_500)
    expect(JSON.stringify(counted)).not.toContain(foreignId)

    const paid = await commit(till, counted.previewId, `rcpt-offers-${randomUUID()}`)

    expect(paid.earned).toBe(13_500)
    expect(paid.grantsIssued).toHaveLength(1)

    const issued = paid.grantsIssued[0]
    const grant = await prisma.offerGrant.findUniqueOrThrow({
      where: { id: issued?.grantId ?? '' },
      select: { code: true, guestId: true, offerId: true, state: true, expiresAt: true },
    })

    // Кассе — только хвост кода; полный — у гостя.
    expect(issued).toMatchObject({
      offerId: promoId,
      title: 'Вернём 200 ฿',
      codeTail: grant.code.slice(-4),
    })
    expect(grant).toMatchObject({ guestId: till.guestId, offerId: promoId, state: 'ISSUED' })
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(DAY_MS - 60_000)

    // Следующий визит: кассир гасит код.
    const redeemed = await request(server())
      .post('/v1/pos/grants/redeem')
      .set('Authorization', `Bearer ${till.token}`)
      .send({ code: grant.code, receiptId: `rcpt-next-${randomUUID()}` })

    expect(redeemed.status).toBeLessThan(300)
    expect((redeemed.body as { grantId: string }).grantId).toBe(issued?.grantId)
  })

  it('ПОВТОР ЧЕКА ВОЗВРАЩАЕТ ТОТ ЖЕ КОД; ВТОРОЙ ЧЕК ГОСТЯ УПИРАЕТСЯ В ЛИМИТ — С ОБЪЯСНЕНИЕМ', async () => {
    const till = await openTill()
    const promoId = await createOffer(till, {
      type: 'PROMO_ON_CHECK',
      title: 'Вернём 200 ฿',
      limits: { minCheck: 80_000, perGuestQty: 1 },
      reward: RETURN_TOMORROW,
    })

    const receiptId = `rcpt-offers-${randomUUID()}`
    const first = await commit(till, (await preview(till, 90_000)).previewId, receiptId)

    // Касса потеряла связь и повторила чек — с новым предрасчётом, но тем же чеком.
    const again = await commit(till, (await preview(till, 90_000)).previewId, receiptId)

    expect(again.replayed).toBe(true)
    expect(again.grantsIssued.map((grant) => grant.grantId)).toEqual(
      first.grantsIssued.map((grant) => grant.grantId),
    )
    expect(await prisma.offerGrant.count({ where: { offerId: promoId } })).toBe(1)

    expect((await preview(till, 90_000)).skippedOffers).toEqual([
      {
        offerId: promoId,
        title: 'Вернём 200 ฿',
        reason: 'LIMIT_REACHED',
        message: 'Гость уже получал эту акцию',
      },
    ])

    const stranger = await createMembershipFixture(prisma, { tenantId: till.tenantId })
    expect((await preview(till, 50_000, stranger.membershipId)).skippedOffers[0]).toMatchObject({
      reason: 'MIN_CHECK',
      message: 'Нужен чек от 800 ฿ — сейчас 500 ฿',
    })
  })

  it('ПОСЛЕДНИЙ КОД УШЁЛ ДРУГОМУ МЕЖДУ ПРЕДРАСЧЁТОМ И ОПЛАТОЙ — ПРОВЕДЕНИЕ СВЕРЯЕТ ЛИМИТ', async () => {
    const till = await openTill()
    await createOffer(till, {
      type: 'PROMO_ON_CHECK',
      title: 'Последний подарок',
      limits: { totalQty: 1 },
      reward: RETURN_TOMORROW,
    })
    const other = await createMembershipFixture(prisma, { tenantId: till.tenantId })

    const mine = await preview(till, 90_000)
    const theirs = await preview(till, 90_000, other.membershipId)

    expect(mine.appliedOffers).toHaveLength(1)
    expect(theirs.appliedOffers).toHaveLength(1)

    expect(
      (await commit(till, theirs.previewId, `rcpt-${randomUUID()}`)).grantsIssued,
    ).toHaveLength(1)

    const late = await commit(till, mine.previewId, `rcpt-${randomUUID()}`)

    // Баллы начислены как обещано, а кода нет: лимит сверен на оплате.
    expect(late.earned).toBe(9_000)
    expect(late.grantsIssued).toEqual([])
  })

  it('ОТМЕНА ЧЕКА АННУЛИРУЕТ НЕВОСТРЕБОВАННЫЙ ПРОМОКОД', async () => {
    const till = await openTill()
    await createOffer(till, {
      type: 'PROMO_ON_CHECK',
      title: 'Вернём 200 ฿',
      reward: RETURN_TOMORROW,
    })

    const paid = await commit(till, (await preview(till, 90_000)).previewId, `rcpt-${randomUUID()}`)
    expect(paid.grantsIssued).toHaveLength(1)

    const voided = await request(server())
      .post(`/v1/pos/transactions/${paid.transactionId}/void`)
      .set('Authorization', `Bearer ${till.token}`)
      .send({ reason: 'WRONG_AMOUNT' })

    expect(voided.status).toBeLessThan(300)

    const grant = await prisma.offerGrant.findUniqueOrThrow({
      where: { id: paid.grantsIssued[0]?.grantId ?? '' },
      select: { state: true },
    })
    expect(grant.state).toBe('VOID')
  })

  it('контрольная группа — без акций и без промокодов', async () => {
    const till = await openTill()
    const promoId = await createOffer(till, {
      type: 'PROMO_ON_CHECK',
      title: 'Вернём 200 ฿',
      reward: RETURN_TOMORROW,
    })
    await prisma.membership.update({
      where: { id: till.membershipId },
      data: { isControlGroup: true },
    })

    const counted = await preview(till, 90_000)

    expect(counted.pointsToEarn).toBe(0)
    expect(counted.skippedOffers).toEqual([
      {
        offerId: promoId,
        title: 'Вернём 200 ฿',
        reason: 'CONTROL_GROUP',
        message: 'Гость в контрольной группе: акции к нему не применяются',
      },
    ])
    expect((await commit(till, counted.previewId, `rcpt-${randomUUID()}`)).grantsIssued).toEqual([])
  })
})
