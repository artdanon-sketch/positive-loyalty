import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant, readBalance } from './ledger-test-context'

/**
 * Сервер кассы POSitive POS: кассир в чеке и подарки за баллы.
 *
 * Владелец 19.11.2026: кассиров связывать «Автоматически», подарок кладёт в
 * чек сама касса строкой ฿0. Отсюда три вещи, которые проверены:
 *   • сервер кассы ходит одной связкой (`POS_LINK`) — человека называет тело,
 *     и лояльность заводит ему сотрудника без входа, один раз;
 *   • от входа по PIN имя в теле не слушается — иначе доплата кому угодно;
 *   • выданную награду касса умеет отменить (чек не записался, чек вернули),
 *     повтор отмены ничего не делает второй раз.
 */

const SECRET = 'pos-cashier-gifts-secret-not-used-anywhere-else'

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
  const link = signAccessToken({ tenantId, actorId: null, role: 'POS_LINK' }, SECRET, 3600)
  const guest = await createMembershipFixture(prisma, { tenantId })
  const coffee = await prisma.catalogItem.create({
    data: { tenantId, name: 'Капучино', pointsPrice: 900 },
  })
  await prisma.catalogItem.create({ data: { tenantId, name: 'Футболка', pointsPrice: null } })

  const pos = (path: string, body: object, token = link) =>
    request(server()).post(path).set('Authorization', `Bearer ${token}`).send(body)

  const sale = async (amount: number, cashier?: { ref: string; name: string }) => {
    const preview = await pos('/v1/pos/transactions/preview', {
      membershipId: guest.membershipId,
      amount,
      redeemRequested: 0,
    }).expect(200)
    const commit = await pos('/v1/pos/transactions/commit', {
      previewId: (preview.body as { previewId: string }).previewId,
      receiptId: `r-${randomUUID()}`,
      ...(cashier ? { cashier } : {}),
    }).expect(200)
    return commit.body as { transactionId: string; earned: number }
  }

  return { tenantId, link, guest, coffee, pos, sale }
}

describe('Кассир POSitive POS в чеке', () => {
  it('ЗАВОДИТ СОТРУДНИКА БЕЗ ВХОДА ОДИН РАЗ, ИМЯ ДОГОНЯЕТ, ЧЕК ЗАПИСАН НА НЕГО', async () => {
    const { tenantId, sale } = await setup()

    const first = await sale(100_000, { ref: 'pos-user-1', name: 'Мария' })
    await sale(50_000, { ref: 'pos-user-1', name: 'Мария К.' })

    const staff = await prisma.staff.findMany({ where: { tenantId, posStaffRef: 'pos-user-1' } })
    expect(staff).toHaveLength(1)
    expect(staff[0]).toMatchObject({
      role: 'CASHIER',
      displayName: 'Мария К.',
      pinHash: null,
      email: null,
    })

    const earn = await prisma.ledgerEntry.findFirst({
      where: { tenantId, id: first.transactionId },
      select: { actorType: true, actorId: true },
    })
    // Первая строка операции — либо списание, либо начисление; у этого чека
    // списания нет, значит это начисление, и на него смотрит доплата за гостя.
    expect(earn).toEqual({ actorType: 'STAFF', actorId: staff[0]?.id })
  })

  it('БЕЗ КАССИРА В ТЕЛЕ ЧЕК, КАК И РАНЬШЕ, НИЧЕЙ', async () => {
    const { tenantId, sale } = await setup()

    const check = await sale(100_000)

    const earn = await prisma.ledgerEntry.findFirst({
      where: { tenantId, id: check.transactionId },
      select: { actorId: true },
    })
    expect(earn?.actorId).toBeNull()
    expect(await prisma.staff.count({ where: { tenantId, posStaffRef: { not: null } } })).toBe(0)
  })

  it('ВХОД ПО PIN: ИМЯ ИЗ ТЕЛА НЕ СЛУШАЕМ, ЧЕК — НА ТОГО, КТО В ТОКЕНЕ', async () => {
    const { tenantId, guest, pos } = await setup()
    const real = await prisma.staff.create({
      data: { tenantId, role: 'CASHIER', displayName: 'Кассир с PIN' },
    })
    const pin = signAccessToken({ tenantId, actorId: real.id, role: 'CASHIER' }, SECRET, 3600)

    const preview = await pos(
      '/v1/pos/transactions/preview',
      { membershipId: guest.membershipId, amount: 100_000, redeemRequested: 0 },
      pin,
    ).expect(200)
    const commit = await pos(
      '/v1/pos/transactions/commit',
      {
        previewId: (preview.body as { previewId: string }).previewId,
        receiptId: `r-${randomUUID()}`,
        cashier: { ref: 'someone-else', name: 'Чужой' },
      },
      pin,
    ).expect(200)

    const earn = await prisma.ledgerEntry.findFirst({
      where: { tenantId, id: (commit.body as { transactionId: string }).transactionId },
      select: { actorId: true },
    })
    expect(earn?.actorId).toBe(real.id)
    expect(await prisma.staff.count({ where: { tenantId, posStaffRef: 'someone-else' } })).toBe(0)
  })
})

describe('Подарок за баллы через сервер кассы', () => {
  it('ВИТРИНА БЕЗ ГОСТЯ — ТОЛЬКО ТО, ЧТО ИМЕЕТ ЦЕНУ В БАЛЛАХ', async () => {
    const { link } = await setup()

    const response = await request(server())
      .get('/v1/pos/rewards/catalog')
      .set('Authorization', `Bearer ${link}`)
      .expect(200)

    expect((response.body as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([
      'Капучино',
    ])
  })

  it('ВЫДАЛ, ОТМЕНИЛ — БАЛЛЫ НАЗАД; ПОВТОР ОТМЕНЫ НИЧЕГО НЕ ДЕЛАЕТ; ВЫДАЧА — НА КАССИРА', async () => {
    const { tenantId, guest, coffee, pos, sale } = await setup()
    await sale(1_000_000)
    const before = await readBalance(prisma, guest.membershipId)
    expect(before).toBeGreaterThanOrEqual(900)

    const redemptionId = randomUUID()
    await pos('/v1/pos/rewards/redeem', {
      membershipId: guest.membershipId,
      itemId: coffee.id,
      redemptionId,
      cashier: { ref: 'pos-user-7', name: 'Олег' },
    }).expect(200)
    expect(await readBalance(prisma, guest.membershipId)).toBe(before - 900)

    const staff = await prisma.staff.findFirst({ where: { tenantId, posStaffRef: 'pos-user-7' } })
    const entry = await prisma.ledgerEntry.findFirst({
      where: { tenantId, refType: 'catalog_item', refId: coffee.id },
      select: { actorId: true },
    })
    expect(entry?.actorId).toBe(staff?.id)

    const voided = await pos('/v1/pos/rewards/void', { redemptionId }).expect(200)
    expect(voided.body).toEqual({
      found: true,
      pointsReturned: 900,
      balanceAfter: before,
      replayed: false,
    })

    const again = await pos('/v1/pos/rewards/void', { redemptionId }).expect(200)
    expect(again.body).toMatchObject({ found: true, pointsReturned: 900, replayed: true })
    expect(await readBalance(prisma, guest.membershipId)).toBe(before)
  })

  it('ОТМЕНА НЕБЫВШЕЙ ВЫДАЧИ — found: false, А НЕ ОШИБКА', async () => {
    const { pos } = await setup()

    const response = await pos('/v1/pos/rewards/void', { redemptionId: randomUUID() }).expect(200)

    expect(response.body).toEqual({
      found: false,
      pointsReturned: 0,
      balanceAfter: null,
      replayed: false,
    })
  })

  it('ЧУЖУЮ ВЫДАЧУ ОТМЕНИТЬ НЕЛЬЗЯ: ДЛЯ ЧУЖОГО ЗАВЕДЕНИЯ ЕЁ НЕТ', async () => {
    const { guest, coffee, pos, sale } = await setup()
    await sale(1_000_000)
    const redemptionId = randomUUID()
    await pos('/v1/pos/rewards/redeem', {
      membershipId: guest.membershipId,
      itemId: coffee.id,
      redemptionId,
    }).expect(200)

    const other = await createTenant(prisma)
    const stranger = signAccessToken(
      { tenantId: other, actorId: null, role: 'POS_LINK' },
      SECRET,
      3600,
    )
    const response = await pos('/v1/pos/rewards/void', { redemptionId }, stranger).expect(200)

    expect(response.body).toMatchObject({ found: false })
  })
})
