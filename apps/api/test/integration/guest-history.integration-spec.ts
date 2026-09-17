import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signGuestToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  idempotencyKey,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * История операций гостя. docs/02, раздел 2.11.
 *
 * Полигон: гость с покупками в двух заведениях и посторонний гость со своей
 * покупкой. Главное, что проверяется, — чужие записи не видны: история это
 * выписка по счёту, и утечка здесь хуже, чем отсутствие экрана.
 */

const SECRET = 'guest-history-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let mine: MembershipFixture
let second: MembershipFixture
let stranger: MembershipFixture
let token: string

const server = (): Server => app.getHttpServer() as Server

interface HistoryBody {
  items: Array<{
    id: string
    venue: string
    type: string
    points: number
    basisAmount: number | null
  }>
  hasMore: boolean
}

const history = async (query = ''): Promise<HistoryBody> => {
  const response = await request(server())
    .get(`/v1/guest/history${query}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)

  return response.body as HistoryBody
}

const earn = async (fixture: MembershipFixture, amount: number, basisAmount: number) => {
  await ledger.earn(
    {
      membershipId: fixture.membershipId,
      amount,
      basisAmount,
      idempotencyKey: idempotencyKey('history'),
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId: undefined,
    },
    fixture.scope,
  )
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
  ledger = moduleRef.get(LedgerService)

  mine = await createMembershipFixture(prisma)
  stranger = await createMembershipFixture(prisma)

  // Второе заведение того же гостя: история одна на все места.
  const otherTenant = await createMembershipFixture(prisma)
  const membership = await prisma.membership.create({
    data: { guestId: mine.guestId, tenantId: otherTenant.tenantId },
    select: { id: true },
  })
  second = {
    ...otherTenant,
    guestId: mine.guestId,
    membershipId: membership.id,
    scope: { tenantId: otherTenant.tenantId },
  }

  await earn(mine, 100, 200_000)
  await earn(second, 50, 100_000)
  await earn(stranger, 999, 900_000)

  token = signGuestToken({ guestId: mine.guestId }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('История гостя', () => {
  it('ОДНА ЛЕНТА НА ВСЕ ЗАВЕДЕНИЯ, С ИМЕНЕМ КАЖДОГО', async () => {
    const body = await history()

    expect(body.items).toHaveLength(2)
    expect(new Set(body.items.map((item) => item.venue)).size).toBe(2)
    expect(body.items.every((item) => item.type === 'EARN')).toBe(true)
  })

  it('ЧУЖИЕ ОПЕРАЦИИ НЕ ВИДНЫ — ЭТО ВЫПИСКА ПО СЧЁТУ', async () => {
    const body = await history()

    expect(body.items.some((item) => item.points === 999)).toBe(false)
  })

  it('СУММА ЧЕКА ПРИХОДИТ РЯДОМ С БАЛЛАМИ: «ЗА ЧТО» ВАЖНЕЕ «СКОЛЬКО»', async () => {
    const body = await history()

    expect(body.items.map((item) => item.basisAmount).sort()).toEqual([100_000, 200_000])
  })

  it('ФИЛЬТР ПО ЗАВЕДЕНИЮ СУЖАЕТ ЛЕНТУ ДО ОДНОГО МЕСТА', async () => {
    const body = await history(`?tenantId=${mine.tenantId}`)

    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.points).toBe(100)
  })

  it('СТРАНИЦЫ: «ЕСТЬ ЕЩЁ» ГОВОРИТСЯ ЧЕСТНО', async () => {
    const first = await history('?limit=1')
    expect(first.items).toHaveLength(1)
    expect(first.hasMore).toBe(true)

    const last = await history('?limit=1&offset=1')
    expect(last.hasMore).toBe(false)
    expect(last.items[0]?.id).not.toBe(first.items[0]?.id)
  })

  it('БЕЗ ТОКЕНА ГОСТЯ ИСТОРИИ НЕТ', async () => {
    const response = await request(server()).get('/v1/guest/history')

    expect(response.status).toBe(401)
  })

  it('ОТМЕНА ЧЕКА ВИДНА ОТДЕЛЬНОЙ СТРОКОЙ, А НЕ ИСЧЕЗНОВЕНИЕМ НАЧИСЛЕНИЯ', async () => {
    const entry = await ledger.earn(
      {
        membershipId: mine.membershipId,
        amount: 30,
        basisAmount: 60_000,
        idempotencyKey: idempotencyKey('history-void'),
        source: 'STAFF_MANUAL',
        actorType: 'STAFF',
        actorId: undefined,
      },
      mine.scope,
    )

    await ledger.reverse(
      {
        entryId: entry.entry.id,
        idempotencyKey: idempotencyKey('history-void-2'),
        reason: 'RECEIPT_VOIDED',
        source: 'STAFF_MANUAL',
        actorType: 'STAFF',
        actorId: undefined,
      },
      mine.scope,
    )

    const body = await history()

    expect(body.items.some((item) => item.type === 'REVERSAL' && item.points === -30)).toBe(true)
    expect(body.items.some((item) => item.points === 30)).toBe(true)
  })
})
