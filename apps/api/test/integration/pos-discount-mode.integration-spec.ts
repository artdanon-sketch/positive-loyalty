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
 * Режим «скидкой сразу». docs/02, разделы 3.2 и 5.6.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 *   скидка вместо баллов   та же ставка вычитается из чека, баллов с покупки нет,
 *                          а визит и деньги гостя всё равно попадают в журнал;
 *   накопленное тратится   баллы, набранные до переключения, гость оплачивает
 *                          долей того, что осталось после скидки;
 *   контрольная группа     ни скидки, ни баллов — иначе нечем доказать эффект;
 *   чек из очереди         оплачен целиком — вместо скидки баллы по той же ставке;
 *   повтор чека            возвращает ту же скидку, а не ноль;
 *   старый клиент          сохранение без режима не переключает заведение обратно;
 *   сосед                  режим одного заведения не трогает чеки другого.
 */

const SECRET = 'pos-discount-mode-secret-not-used-anywhere-else'
const HOUR = 60 * 60

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

const token = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET, HOUR)

interface Place {
  tenantId: string
  membershipId: string
  owner: string
  cashier: string
}

interface PreviewBody {
  previewId: string
  amount: number
  discount: number
  maxRedeemable: number
  redeem: number
  amountToPay: number
  pointsToEarn: number
}

interface CommitBody {
  earned: number
  discount: number
  redeemed: number
  newBalance: number
  replayed: boolean
}

/** Заведение на 5 % и до 20 % чека баллами, номер чека не обязателен. */
const venue = async (): Promise<Place> => {
  const tenantId = await createTenant(prisma)
  const { membershipId } = await createMembershipFixture(prisma, { tenantId })

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        baseEarnRate: 5,
        baseRedeemRate: 20,
        cashierRules: { requireReceiptNumber: false },
      },
    },
  })

  return {
    tenantId,
    membershipId,
    owner: token(tenantId, 'OWNER'),
    cashier: token(tenantId, 'CASHIER'),
  }
}

const settingsBody = (mode?: 'CASHBACK' | 'DISCOUNT'): object => ({
  ...(mode === undefined ? {} : { mode }),
  baseEarnRate: 5,
  baseRedeemRate: 20,
  cashierRules: { requireReceiptNumber: false, maxManualAmount: null, allowManualEntry: true },
})

const switchTo = async (place: Place, mode: 'CASHBACK' | 'DISCOUNT'): Promise<void> => {
  await request(server())
    .put('/v1/admin/settings/program')
    .set('Authorization', `Bearer ${place.owner}`)
    .send(settingsBody(mode))
    .expect(200)
}

const preview = async (
  place: Place,
  body: { amount: number; redeemRequested?: number; withoutDiscount?: boolean },
): Promise<PreviewBody> => {
  const response = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${place.cashier}`)
    .send({ membershipId: place.membershipId, ...body })
    .expect(200)

  return response.body as PreviewBody
}

const commit = async (place: Place, previewId: string, receiptId: string): Promise<CommitBody> => {
  const response = await request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${place.cashier}`)
    .send({ previewId, receiptId })
    .expect(200)

  return response.body as CommitBody
}

let receiptSeq = 0
const nextReceipt = (): string => {
  receiptSeq += 1
  return `discount-${Date.now()}-${receiptSeq}`
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
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Скидка вместо баллов', () => {
  it('ВЛАДЕЛЕЦ ВКЛЮЧИЛ — КАССА ВЫЧИТАЕТ СТАВКУ ИЗ ЧЕКА, БАЛЛОВ С ПОКУПКИ НЕТ', async () => {
    const place = await venue()
    await switchTo(place, 'DISCOUNT')

    const settings = await request(server())
      .get('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.owner}`)
      .expect(200)
    expect((settings.body as { mode: string }).mode).toBe('DISCOUNT')

    const calc = await preview(place, { amount: 100_000 })
    expect(calc).toMatchObject({ discount: 5_000, amountToPay: 95_000, pointsToEarn: 0 })

    const receiptId = nextReceipt()
    const done = await commit(place, calc.previewId, receiptId)
    expect(done).toMatchObject({ discount: 5_000, earned: 0, newBalance: 0, replayed: false })

    // Визит и деньги гостя — в журнале: нулевое начисление с суммой,
    // которую гость заплатил на самом деле.
    const earn = await prisma.ledgerEntry.findFirstOrThrow({
      where: { tenantId: place.tenantId, refId: receiptId, type: 'EARN' },
      select: { amount: true, basisAmount: true },
    })
    expect(earn).toEqual({ amount: 0, basisAmount: 95_000 })

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: place.membershipId },
      select: { visitsTotal: true },
    })
    expect(membership.visitsTotal).toBe(1)
  })

  it('ПОВТОР ПРОВЕДЕНИЯ ВОЗВРАЩАЕТ ТУ ЖЕ СКИДКУ, А НЕ НОЛЬ', async () => {
    const place = await venue()
    await switchTo(place, 'DISCOUNT')

    const calc = await preview(place, { amount: 60_000 })
    const receiptId = nextReceipt()
    await commit(place, calc.previewId, receiptId)

    const again = await commit(place, calc.previewId, receiptId)
    expect(again).toMatchObject({ discount: 3_000, earned: 0, replayed: true })
  })

  it('НАКОПЛЕННОЕ ДО ПЕРЕКЛЮЧЕНИЯ ТРАТИТСЯ — ДОЛЕЙ ТОГО, ЧТО ОСТАЛОСЬ ПОСЛЕ СКИДКИ', async () => {
    const place = await venue()

    // Под баллами гость накопил 5 % от 4 000 ฿ = 200 ฿.
    const earned = await preview(place, { amount: 400_000 })
    await commit(place, earned.previewId, nextReceipt())

    await switchTo(place, 'DISCOUNT')

    // 1 000 ฿ − 50 ฿ скидки = 950 ฿; баллами — до 20 % от 950 = 190 ฿.
    const calc = await preview(place, { amount: 100_000, redeemRequested: 20_000 })
    expect(calc).toMatchObject({
      discount: 5_000,
      maxRedeemable: 19_000,
      redeem: 19_000,
      amountToPay: 76_000,
      pointsToEarn: 0,
    })

    const done = await commit(place, calc.previewId, nextReceipt())
    expect(done).toMatchObject({ discount: 5_000, redeemed: 19_000, newBalance: 1_000 })
  })

  it('КОНТРОЛЬНОЙ ГРУППЕ — НИ СКИДКИ, НИ БАЛЛОВ', async () => {
    const place = await venue()
    await switchTo(place, 'DISCOUNT')
    await prisma.membership.update({
      where: { id: place.membershipId },
      data: { isControlGroup: true },
    })

    const calc = await preview(place, { amount: 100_000 })
    expect(calc).toMatchObject({ discount: 0, amountToPay: 100_000, pointsToEarn: 0 })
  })

  it('ЧЕК ИЗ ОЧЕРЕДИ ОПЛАЧЕН ЦЕЛИКОМ — ВМЕСТО СКИДКИ БАЛЛЫ ПО ТОЙ ЖЕ СТАВКЕ', async () => {
    const place = await venue()
    await switchTo(place, 'DISCOUNT')

    const calc = await preview(place, { amount: 100_000, withoutDiscount: true })
    expect(calc).toMatchObject({ discount: 0, amountToPay: 100_000, pointsToEarn: 5_000 })

    const done = await commit(place, calc.previewId, nextReceipt())
    expect(done).toMatchObject({ discount: 0, earned: 5_000 })
  })

  it('СТАРЫЙ КЛИЕНТ БЕЗ РЕЖИМА НЕ ПЕРЕКЛЮЧАЕТ ОБРАТНО, А ЯВНЫЙ ВЫБОР — ПЕРЕКЛЮЧАЕТ', async () => {
    const place = await venue()
    await switchTo(place, 'DISCOUNT')

    const kept = await request(server())
      .put('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.owner}`)
      .send(settingsBody())
      .expect(200)
    expect((kept.body as { mode: string }).mode).toBe('DISCOUNT')
    expect((await preview(place, { amount: 100_000 })).discount).toBe(5_000)

    await switchTo(place, 'CASHBACK')
    expect(await preview(place, { amount: 100_000 })).toMatchObject({
      discount: 0,
      pointsToEarn: 5_000,
    })
  })

  it('КАССИР РЕЖИМ НЕ ПЕРЕКЛЮЧИТ, А НЕИЗВЕСТНЫЙ РЕЖИМ НЕ СОХРАНИТСЯ', async () => {
    const place = await venue()

    await request(server())
      .put('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.cashier}`)
      .send(settingsBody('DISCOUNT'))
      .expect(403)

    await request(server())
      .put('/v1/admin/settings/program')
      .set('Authorization', `Bearer ${place.owner}`)
      .send({ ...settingsBody(), mode: 'STAMPS' })
      .expect(400)

    expect((await preview(place, { amount: 100_000 })).discount).toBe(0)
  })

  it('РЕЖИМ ОДНОГО ЗАВЕДЕНИЯ НЕ ТРОГАЕТ ЧЕКИ СОСЕДА', async () => {
    const mine = await venue()
    const neighbour = await venue()

    await switchTo(mine, 'DISCOUNT')

    expect((await preview(mine, { amount: 100_000 })).discount).toBe(5_000)
    expect(await preview(neighbour, { amount: 100_000 })).toMatchObject({
      discount: 0,
      pointsToEarn: 5_000,
    })

    // И чужой гость в моём режиме не считается вовсе.
    await request(server())
      .post('/v1/pos/transactions/preview')
      .set('Authorization', `Bearer ${mine.cashier}`)
      .send({ membershipId: neighbour.membershipId, amount: 100_000 })
      .expect(404)
  })
})
