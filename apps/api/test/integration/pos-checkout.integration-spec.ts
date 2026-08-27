import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture } from './ledger-test-context'

/**
 * Сквозной путь кассы: найти гостя → посчитать → провести.
 * docs/02, раздел 3.
 */

const SECRET = 'pos-integration-secret-not-used-anywhere-else'
const PIN = '7412'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let membershipId: string
let guestPhone: string
let token: string

const server = (): Server => app.getHttpServer() as Server

interface PreviewBody {
  previewId: string
  maxRedeemable: number
  redeem: number
  amountToPay: number
  pointsToEarn: number
  balanceAtPreview: number
}

interface CommitBody {
  transactionId: string
  redeemed: number
  earned: number
  newBalance: number
  replayed: boolean
}

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

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
  membershipId = fixture.membershipId

  const guest = await prisma.guest.findFirstOrThrow({ where: { id: fixture.guestId } })
  guestPhone = guest.phoneE164

  // Настройки программы: 10% начисления, до 20% чека баллами, номер чека не обязателен.
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

  const staff = await prisma.staff.create({
    data: {
      tenantId,
      role: 'CASHIER',
      displayName: 'Кассир на смене',
      pinHash: await hashPin(PIN),
    },
    select: { id: true },
  })

  const deviceId = `device-pos-${Date.now()}`
  await prisma.staffDevice.create({
    data: { tenantId, staffId: staff.id, deviceId, label: 'Планшет кассы' },
  })

  const login = await request(server())
    .post('/v1/auth/staff/pin')
    .send({ deviceId, pin: PIN })
    .expect(200)

  token = (login.body as { accessToken: string }).accessToken
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Поиск гостя на кассе', () => {
  it('находит участника этого заведения', async () => {
    const response = await request(server())
      .get(`/v1/pos/guest?phone=${encodeURIComponent(guestPhone)}`)
      .set(...auth())
      .expect(200)

    const body = response.body as { membershipId: string; points: number; visitsTotal: number }
    expect(body.membershipId).toBe(membershipId)
    expect(body.points).toBe(0)
    expect(body.visitsTotal).toBe(0)
  })

  it('незнакомый номер даёт 404 — тем же ответом, что и чужой гость', async () => {
    await request(server())
      .get('/v1/pos/guest?phone=%2B66800000000')
      .set(...auth())
      .expect(404)
  })

  it('без токена касса закрыта', async () => {
    await request(server())
      .get(`/v1/pos/guest?phone=${encodeURIComponent(guestPhone)}`)
      .expect(401)
  })
})

describe('Предрасчёт', () => {
  it('считает начисление от суммы, уплаченной деньгами', async () => {
    const response = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId, amount: 100_000 })
      .expect(200)

    const body = response.body as PreviewBody
    // Баланс нулевой, списывать нечего.
    expect(body.maxRedeemable).toBe(0)
    expect(body.redeem).toBe(0)
    expect(body.amountToPay).toBe(100_000)
    // 10% от 1000 бат = 100 бат.
    expect(body.pointsToEarn).toBe(10_000)
  })

  it('потолок списания ограничен и долей чека, и балансом', async () => {
    // Сначала накопим баллы: 10% от 5000 бат.
    const first = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId, amount: 500_000 })
      .expect(200)

    await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId: (first.body as PreviewBody).previewId, receiptId: `rcpt-${Date.now()}` })
      .expect(200)

    // Теперь на балансе 50 000 (500 бат), а 20% от чека в 1000 бат — это 20 000.
    const response = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId, amount: 100_000, redeemRequested: 50_000 })
      .expect(200)

    const body = response.body as PreviewBody
    // Ограничивает доля чека, а не баланс: 20 000 < 50 000.
    expect(body.maxRedeemable).toBe(20_000)
    expect(body.redeem).toBe(20_000)
    expect(body.amountToPay).toBe(80_000)
    // Начисление идёт с 80 000, а не со 100 000: на часть, оплаченную баллами,
    // проценты не начисляются — иначе заведение платит само себе.
    expect(body.pointsToEarn).toBe(8_000)
  })
})

describe('Проведение чека', () => {
  it('меняет баланс и создаёт запись в журнале', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })

    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 200_000 })
      .expect(200)

    const receiptId = `rcpt-commit-${Date.now()}`
    const response = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId: (preview.body as PreviewBody).previewId, receiptId })
      .expect(200)

    const body = response.body as CommitBody
    expect(body.earned).toBe(20_000)
    expect(body.newBalance).toBe(20_000)
    expect(body.replayed).toBe(false)

    // Операция действительно в журнале и привязана к номеру чека.
    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId } }),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.refType).toBe('receipt')
  })

  it('повтор того же чека не создаёт вторую операцию', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const receiptId = `rcpt-replay-${Date.now()}`

    const first = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 300_000 })
      .expect(200)

    const committed = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId: (first.body as PreviewBody).previewId, receiptId })
      .expect(200)

    // Касса потеряла связь и повторила чек — с НОВЫМ предрасчётом, но тем же чеком.
    const second = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 300_000 })
      .expect(200)

    const repeat = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId: (second.body as PreviewBody).previewId, receiptId })
      .expect(200)

    const repeatBody = repeat.body as CommitBody
    expect(repeatBody.replayed).toBe(true)
    expect(repeatBody.transactionId).toBe((committed.body as CommitBody).transactionId)

    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId } }),
    )
    expect(entries).toHaveLength(1)
  })

  it('повтор ТОГО ЖЕ запроса возвращает первый ответ, а не BALANCE_CHANGED', async () => {
    // Самый частый повтор на кассе: у планшета отвалилась сеть уже после того,
    // как сервер провёл чек, и он шлёт ровно тот же запрос ещё раз — с тем же
    // предрасчётом. Соседний тест повторяет чек с НОВЫМ предрасчётом, и там
    // баланс в предрасчёте уже свежий; здесь предрасчёт помнит баланс ДО чека,
    // и наивная проверка «баланс изменился» отвергала повтор, требуя пересчёта
    // того, что уже начислено.
    const fixture = await createMembershipFixture(prisma, { tenantId })
    const receiptId = `rcpt-same-request-${Date.now()}`

    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 300_000 })
      .expect(200)

    const payload = { previewId: (preview.body as PreviewBody).previewId, receiptId }

    const first = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send(payload)
      .expect(200)

    const second = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send(payload)
      .expect(200)

    const firstBody = first.body as CommitBody
    const secondBody = second.body as CommitBody

    // Ответ обязан совпасть с первым во всём, кроме признака повтора.
    expect(secondBody.transactionId).toBe(firstBody.transactionId)
    expect(secondBody.earned).toBe(firstBody.earned)
    expect(secondBody.redeemed).toBe(firstBody.redeemed)
    expect(secondBody.newBalance).toBe(firstBody.newBalance)
    expect(firstBody.replayed).toBe(false)
    expect(secondBody.replayed).toBe(true)

    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId } }),
    )
    expect(entries).toHaveLength(1)
  })

  it('устаревший предрасчёт отклоняется с PREVIEW_EXPIRED', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })

    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 100_000 })
      .expect(200)

    const previewId = (preview.body as PreviewBody).previewId

    // Отматываем срок назад, а не ждём десять минут.
    await prisma.forTenant(tenantId, async (tx) => {
      await tx.transactionPreview.updateMany({
        where: { id: previewId, tenantId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      })
    })

    const response = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId, receiptId: `rcpt-expired-${Date.now()}` })
      .expect(400)

    expect(JSON.stringify(response.body)).toMatch(/PREVIEW_EXPIRED/)
  })

  it('изменившийся баланс отклоняется с BALANCE_CHANGED', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })

    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 100_000 })
      .expect(200)

    // Гость потратил баллы в соседнем заведении сети, пока кассир пробивал чек:
    // проводим стороннее начисление тем же участием.
    const other = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 100_000 })
      .expect(200)

    await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({
        previewId: (other.body as PreviewBody).previewId,
        receiptId: `rcpt-other-${Date.now()}`,
      })
      .expect(200)

    const response = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({
        previewId: (preview.body as PreviewBody).previewId,
        receiptId: `rcpt-stale-${Date.now()}`,
      })
      .expect(400)

    expect(JSON.stringify(response.body)).toMatch(/BALANCE_CHANGED/)
  })
})

describe('Контрольная группа', () => {
  it('визит записывается нулевым начислением: баланс нулевой, визит посчитан', async () => {
    const fixture = await createMembershipFixture(prisma, { tenantId })
    await prisma.membership.update({
      where: { id: fixture.membershipId },
      data: { isControlGroup: true },
    })

    const preview = await request(server())
      .post('/v1/pos/transactions/preview')
      .set(...auth())
      .send({ membershipId: fixture.membershipId, amount: 150_000 })
      .expect(200)

    expect((preview.body as PreviewBody).pointsToEarn).toBe(0)

    const receiptId = `rcpt-control-${Date.now()}`
    const commit = await request(server())
      .post('/v1/pos/transactions/commit')
      .set(...auth())
      .send({ previewId: (preview.body as PreviewBody).previewId, receiptId })
      .expect(200)

    const body = commit.body as CommitBody
    expect(body.earned).toBe(0)
    expect(body.newBalance).toBe(0)

    // Визит и потраченное посчитаны — иначе группе не с чем сравнивать основную.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { id: fixture.membershipId },
    })
    expect(membership.pointsBalance).toBe(0)
    expect(membership.visitsTotal).toBe(1)
    expect(membership.spentTotal).toBe(150_000)

    // В журнале ровно одна запись чека — нулевое начисление.
    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId } }),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('EARN')
    expect(entries[0]?.amount).toBe(0)
    expect(entries[0]?.basisAmount).toBe(150_000)
  })
})
