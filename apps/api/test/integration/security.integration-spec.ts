import { randomInt, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createLedgerTestContext,
  createMembershipFixture,
  idempotencyKey,
  POS_ORIGIN,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Безопасность заведения. docs/02, разделы 5.13 и 5.6.5 · docs/11, У12.
 *
 * Полигон: частый гость (шесть чеков за день и отменённый седьмой), обычный гость
 * (три чека), кассир со всплеском (месяц по чеку в день и пятнадцать сегодня), кассир,
 * пробивший чек на свой же номер. У соседнего заведения — своя история.
 *
 * История читается функцией базы — её права проверены под ролью приложения (последний блок):
 * HTTP-проверки ходят владельцем базы, которого права не касаются.
 */

const SECRET = 'security-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let frequent: MembershipFixture
let regular: MembershipFixture
let crowd: MembershipFixture
let neighbour: MembershipFixture
let ownerId: string
let burstCashierId: string
let selfCashierId: string
let ownerToken: string
let managerToken: string
let neighbourOwnerToken: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`

interface SuspiciousBody {
  maxChecksPerDay: number
  guests: Array<{ membershipId: string; receipts: number }>
  cashiers: Array<{ staffId: string; displayName: string; signal: string; receipts: number }>
}

interface HistoryBody {
  items: Array<{
    action: string
    occurredAt: string
    actorType: string
    actor: { id: string; displayName: string } | null
  }>
  nextBefore: string | null
}

const receipt = async (
  fixture: MembershipFixture,
  options: { readonly cashier?: string; readonly occurredAt?: Date } = {},
): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId: fixture.membershipId,
      amount: 100,
      basisAmount: 2_000,
      idempotencyKey: idempotencyKey('security-check'),
      refType: 'receipt',
      refId: `sc-${randomUUID().slice(0, 8)}`,
      ...(options.cashier === undefined
        ? POS_ORIGIN
        : {
            source: 'STAFF_MANUAL' as const,
            actorType: 'STAFF' as const,
            actorId: options.cashier,
          }),
      ...(options.occurredAt === undefined ? {} : { occurredAt: options.occurredAt.toISOString() }),
    },
    { tenantId: fixture.tenantId },
  )

  return result.entry.id
}

const suspicious = async (token: string): Promise<SuspiciousBody> =>
  (
    await request(server())
      .get('/v1/admin/security/suspicious?period=7d')
      .set('Authorization', bearer(token))
  ).body as SuspiciousBody

/** Настоящий PrismaService под ролью приложения — приём из ledger-app-role. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — права функции истории не проверить.')
  }

  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = url

  try {
    return await createLedgerTestContext()
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL']
    } else {
      process.env['DATABASE_URL'] = previous
    }
  }
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

  frequent = await createMembershipFixture(prisma)
  const tenantId = frequent.tenantId
  regular = await createMembershipFixture(prisma, { tenantId })
  crowd = await createMembershipFixture(prisma, { tenantId })
  neighbour = await createMembershipFixture(prisma)

  const staff = async (displayName: string, role: 'OWNER' | 'CASHIER', phone?: string) =>
    (
      await prisma.staff.create({
        data: { tenantId, displayName, role, ...(phone === undefined ? {} : { phoneE164: phone }) },
        select: { id: true },
      })
    ).id

  ownerId = await staff('Владелец Артём', 'OWNER')
  burstCashierId = await staff('Кассир Лек', 'CASHIER')

  // Кассир пробил чек на гостя со своим же номером.
  const selfPhone = `+66${String(randomInt(100_000_000, 999_999_999))}`
  selfCashierId = await staff('Кассир Пим', 'CASHIER', selfPhone)
  const selfGuest = await prisma.guest.create({
    data: { phoneE164: selfPhone },
    select: { id: true },
  })
  const selfMembership = await prisma.membership.create({
    data: { guestId: selfGuest.id, tenantId },
    select: { id: true },
  })
  await receipt(
    { ...frequent, guestId: selfGuest.id, membershipId: selfMembership.id },
    { cashier: selfCashierId },
  )

  for (let index = 0; index < 6; index += 1) {
    await receipt(frequent)
  }
  const voided = await receipt(frequent)
  await ledger.reverse(
    {
      entryId: voided,
      idempotencyKey: idempotencyKey('security-void'),
      reason: 'RECEIPT_VOIDED',
      ...POS_ORIGIN,
    },
    { tenantId },
  )

  for (let index = 0; index < 3; index += 1) {
    await receipt(regular)
  }

  // Месяц по чеку в день — «обычно», пятнадцать сегодня — всплеск.
  for (let day = 10; day < 30; day += 1) {
    await receipt(crowd, {
      cashier: burstCashierId,
      occurredAt: new Date(Date.now() - day * DAY_MS),
    })
  }
  for (let index = 0; index < 15; index += 1) {
    await receipt(crowd, { cashier: burstCashierId })
  }

  ownerToken = signAccessToken({ tenantId, actorId: ownerId, role: 'OWNER' }, SECRET)
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
  neighbourOwnerToken = signAccessToken(
    { tenantId: neighbour.tenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('Безопасность: подозрительное', () => {
  it('ГОСТЬ С ШЕСТЬЮ ЧЕКАМИ ЗА ДЕНЬ — ПОВОД ПОСМОТРЕТЬ; ОТМЕНЁННЫЙ ЧЕК НЕ В СЧЁТ', async () => {
    const body = await suspicious(ownerToken)

    expect(body.maxChecksPerDay).toBe(5)
    expect(body.guests.find((row) => row.membershipId === frequent.membershipId)).toMatchObject({
      receipts: 6,
    })
    expect(body.guests.map((row) => row.membershipId)).not.toContain(regular.membershipId)
  })

  it('КАССИР С ЧЕКОМ НА СВОЙ НОМЕР И КАССИР СО ВСПЛЕСКОМ — В СПИСКЕ, ПЕРВЫМ СВОЙ НОМЕР', async () => {
    const body = await suspicious(ownerToken)

    expect(body.cashiers[0]).toMatchObject({
      staffId: selfCashierId,
      displayName: 'Кассир Пим',
      signal: 'SELF_LINKED',
      receipts: 1,
    })
    expect(body.cashiers.find((row) => row.staffId === burstCashierId)).toMatchObject({
      signal: 'BURST',
      receipts: 15,
    })
  })

  it('ПОРОГ МЕНЯЕТ ВЛАДЕЛЕЦ — И ОБЫЧНЫЙ ГОСТЬ С ТРЕМЯ ЧЕКАМИ ПОПАДАЕТ В СПИСОК', async () => {
    const path = '/v1/admin/settings/program/suspicious'

    const saved = await request(server())
      .put(path)
      .set('Authorization', bearer(ownerToken))
      .send({ maxChecksPerDay: 2 })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ maxChecksPerDay: 2 })

    const tooLow = await request(server())
      .put(path)
      .set('Authorization', bearer(ownerToken))
      .send({ maxChecksPerDay: 1 })
    expect(tooLow.status).toBe(400)

    const body = await suspicious(ownerToken)
    expect(body.maxChecksPerDay).toBe(2)
    expect(body.guests.map((row) => row.membershipId)).toContain(regular.membershipId)
  })

  it('СОСЕДНЕЕ ЗАВЕДЕНИЕ НАШИХ КАССИРОВ НЕ ВИДИТ; МЕНЕДЖЕРУ ЭКРАН ЗАКРЫТ', async () => {
    const foreign = await suspicious(neighbourOwnerToken)
    expect(foreign.cashiers).toEqual([])
    expect(foreign.guests.map((row) => row.membershipId)).not.toContain(frequent.membershipId)

    const forbidden = await request(server())
      .get('/v1/admin/security/suspicious')
      .set('Authorization', bearer(managerToken))
    expect(forbidden.status).toBe(403)
  })
})

describe('Безопасность: история действий', () => {
  it('СМЕНА ПОРОГА ВИДНА В ИСТОРИИ С ИМЕНЕМ ВЛАДЕЛЬЦА; СОСЕДИ ЕЁ НЕ ВИДЯТ', async () => {
    const own = await request(server())
      .get('/v1/admin/security/history')
      .set('Authorization', bearer(ownerToken))
    expect(own.status).toBe(200)

    const body = own.body as HistoryBody
    expect(body.items[0]).toMatchObject({
      action: 'PROGRAM_CONFIG_CHANGED',
      actorType: 'OWNER',
      actor: { id: ownerId, displayName: 'Владелец Артём' },
    })

    const foreign = (
      await request(server())
        .get('/v1/admin/security/history')
        .set('Authorization', bearer(neighbourOwnerToken))
    ).body as HistoryBody
    expect(foreign.items).toEqual([])

    const bad = await request(server())
      .get('/v1/admin/security/history?before=вчера')
      .set('Authorization', bearer(ownerToken))
    expect(bad.status).toBe(400)
  })

  it('ИСТОРИЯ СУЖАЕТСЯ ДО СУТОК ЗАВЕДЕНИЯ И ДО ОДНОГО СОТРУДНИКА', async () => {
    const history = async (params: string): Promise<HistoryBody> =>
      (
        await request(server())
          .get(`/v1/admin/security/history${params}`)
          .set('Authorization', bearer(ownerToken))
      ).body as HistoryBody

    // Сутки заведения, а не UTC: в Бангкоке день сменяется на семь часов раньше.
    const venueDay = (at: Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(at)
    const today = venueDay(new Date())

    const own = await history(`?day=${today}`)
    expect(own.items.map((item) => item.action)).toContain('PROGRAM_CONFIG_CHANGED')
    expect(own.items.every((item) => venueDay(new Date(item.occurredAt)) === today)).toBe(true)

    const longAgo = await history(`?day=${venueDay(new Date(Date.now() - 30 * DAY_MS))}`)
    expect(longAgo.items).toEqual([])

    const mine = await history(`?actorId=${ownerId}`)
    expect(mine.items.length).toBeGreaterThan(0)
    expect(mine.items.every((item) => item.actor?.id === ownerId)).toBe(true)

    const stranger = await history(`?actorId=${randomUUID()}`)
    expect(stranger.items).toEqual([])

    const nonsense = await request(server())
      .get('/v1/admin/security/history?day=2026-02-30')
      .set('Authorization', bearer(ownerToken))
    expect(nonsense.status).toBe(400)
  })
})

describe('Безопасность: функция истории под ролью приложения', () => {
  let appRole: LedgerTestContext

  beforeAll(async () => {
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('РОЛЬ ПРИЛОЖЕНИЯ ЧИТАЕТ ИСТОРИЮ ТОЛЬКО СВОЕГО ЗАВЕДЕНИЯ И НИЧЕГО — БЕЗ ОБЪЯВЛЕННОГО', async () => {
    const call = "SELECT * FROM tenant_audit_history(now() + interval '1 minute', 100, NULL, NULL)"

    const own = await appRole.prisma.forTenant(frequent.tenantId, async (tx) =>
      tx.$queryRawUnsafe<Array<{ action: string }>>(call),
    )
    expect(own.map((row) => row.action)).toContain('PROGRAM_CONFIG_CHANGED')

    const foreign = await appRole.prisma.forTenant(neighbour.tenantId, async (tx) =>
      tx.$queryRawUnsafe<Array<{ action: string }>>(call),
    )
    expect(foreign).toEqual([])

    expect(await appRole.prisma.$queryRawUnsafe<unknown[]>(call)).toEqual([])
  })
})
