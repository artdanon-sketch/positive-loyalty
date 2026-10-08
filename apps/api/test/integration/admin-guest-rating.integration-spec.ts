import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Рейтинг и новые фильтры гостей: порядок списка, покупки, баллы, день рождения,
 * отчёт «Лучшие гости». docs/02, разделы 5.2 и 5.10.
 *
 * Полигон (дни рождения — от сегодняшнего дня по часам Пхукета):
 *
 *   Ким   12 покупок, 9 000 ฿, 1 500 ฿ баллами, день рождения сегодня;
 *   Пат    5 покупок, 4 000 ฿,   600 ฿ баллами, дня рождения не указал;
 *   Ли     3 покупки, 2 000 ฿, баллов нет,       день рождения через три дня;
 *   Май    1 покупка,   500 ฿,    50 ฿ баллами;
 *   Ной   не покупал,             баллов нет,    день рождения через два месяца.
 *
 * У соседа — именинник сегодня с полусотней покупок: ловушка для изоляции.
 */

const SECRET = 'admin-guest-rating-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let tenantId: string
let owner: string
let manager: string
let cashier: string
let kim: MembershipFixture
let pat: MembershipFixture
let lee: MembershipFixture
let mai: MembershipFixture
let noi: MembershipFixture
let stranger: MembershipFixture

interface ListBody {
  items: Array<{ membershipId: string }>
  total: number
}

interface TopBody {
  period: string
  guests: Array<{
    rank: number
    membershipId: string
    phone: string | null
    purchases: number
    turnover: number
    pointsBalance: number
  }>
}

const server = (): Server => app.getHttpServer() as Server

const list = async (query: string, token = manager): Promise<string[]> =>
  (
    (
      await request(server())
        .get(`/v1/admin/guests?limit=100&${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ListBody
  ).items.map((row) => row.membershipId)

const sorted = (values: string[]): string[] => [...values].sort()

/** День рождения через `days` дней от сегодняшнего дня Пхукета. Год високосный — ради 29 февраля. */
const birthdayIn = (days: number): Date => {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const day = new Date(new Date(`${local}T00:00:00.000Z`).getTime() + days * DAY_MS)

  return new Date(Date.UTC(1992, day.getUTCMonth(), day.getUTCDate()))
}

const seedGuest = async (
  venue: string,
  data: {
    name: string
    visits: number
    spent: number
    points: number
    birthday: Date | null
  },
): Promise<MembershipFixture> => {
  const fixture = await createMembershipFixture(prisma, { tenantId: venue })

  await prisma.guest.update({
    where: { id: fixture.guestId },
    data: { displayName: data.name, birthday: data.birthday },
  })

  // Баллы — только через журнал (CLAUDE.md, правило 1), подарком, а не чеком:
  // чек попал бы в отчёт «Лучшие гости», который проверяется ниже.
  if (data.points > 0) {
    await ledger.grant(
      {
        membershipId: fixture.membershipId,
        amount: data.points,
        idempotencyKey: `rating-seed-${fixture.membershipId}`,
        refType: 'promo',
        refId: 'rating-seed',
        source: 'SYSTEM',
        actorType: 'SYSTEM',
      },
      { tenantId: venue },
    )
  }

  // Счётчики покупок — напрямую: рейтинг списка читает их, а журнал покупок
  // за прошлые месяцы полигону не нужен.
  await prisma.membership.update({
    where: { id: fixture.membershipId },
    data: {
      visitsTotal: data.visits,
      spentTotal: data.spent,
      lastVisitAt: data.visits === 0 ? null : new Date(Date.now() - DAY_MS),
    },
  })

  return fixture
}

const sell = async (token: string, membershipId: string, amount: number): Promise<string> => {
  const preview = await request(server())
    .post('/v1/pos/transactions/preview')
    .set('Authorization', `Bearer ${token}`)
    .send({ membershipId, amount })
    .expect(200)
  const commit = await request(server())
    .post('/v1/pos/transactions/commit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      previewId: (preview.body as { previewId: string }).previewId,
      receiptId: `rating-${membershipId.slice(0, 8)}-${String(Date.now())}-${String(amount)}`,
    })
    .expect(200)

  return (commit.body as { transactionId: string }).transactionId
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

  tenantId = await createTenant(prisma)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { cashierRules: { requireReceiptNumber: false } } },
  })

  kim = await seedGuest(tenantId, {
    name: 'Ким',
    visits: 12,
    spent: 900_000,
    points: 150_000,
    birthday: birthdayIn(0),
  })
  pat = await seedGuest(tenantId, {
    name: 'Пат',
    visits: 5,
    spent: 400_000,
    points: 60_000,
    birthday: null,
  })
  lee = await seedGuest(tenantId, {
    name: 'Ли',
    visits: 3,
    spent: 200_000,
    points: 0,
    birthday: birthdayIn(3),
  })
  mai = await seedGuest(tenantId, {
    name: 'Май',
    visits: 1,
    spent: 50_000,
    points: 5_000,
    birthday: null,
  })
  noi = await seedGuest(tenantId, {
    name: 'Ной',
    visits: 0,
    spent: 0,
    points: 0,
    birthday: birthdayIn(62),
  })

  const neighbour = await createTenant(prisma)
  stranger = await seedGuest(neighbour, {
    name: 'Чужой именинник',
    visits: 50,
    spent: 9_000_000,
    points: 900_000,
    birthday: birthdayIn(0),
  })

  const sign = (role: string): string => signAccessToken({ tenantId, actorId: null, role }, SECRET)
  owner = sign('OWNER')
  manager = sign('MANAGER')
  cashier = sign('CASHIER')
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Рейтинг в списке гостей', () => {
  it('«БОЛЬШЕ ПОТРАТИЛИ», «ЧАЩЕ ПОКУПАЛИ», «БОЛЬШЕ БАЛЛОВ» — ВСЕ ГОСТИ, ДРУГОЙ ПОРЯДОК', async () => {
    expect(await list('sort=spent')).toEqual([
      kim.membershipId,
      pat.membershipId,
      lee.membershipId,
      mai.membershipId,
      noi.membershipId,
    ])
    expect(await list('sort=visits')).toEqual([
      kim.membershipId,
      pat.membershipId,
      lee.membershipId,
      mai.membershipId,
      noi.membershipId,
    ])
    expect((await list('sort=points')).slice(0, 3)).toEqual([
      kim.membershipId,
      pat.membershipId,
      mai.membershipId,
    ])
    // По умолчанию — недавние сверху, не покупавший — в конце.
    expect((await list('')).at(-1)).toBe(noi.membershipId)
  })

  it('ПОКУПОК «ОТ 2 ДО 4» И «ОТ 5»; БАЛЛОВ «НЕТ» И «ОТ 100 ฿»', async () => {
    expect(await list('visitsFrom=2&visitsTo=4')).toEqual([lee.membershipId])
    expect(sorted(await list('visitsFrom=5'))).toEqual(sorted([kim.membershipId, pat.membershipId]))
    expect(sorted(await list('pointsTo=0'))).toEqual(sorted([lee.membershipId, noi.membershipId]))
    expect(sorted(await list('pointsFrom=10000'))).toEqual(
      sorted([kim.membershipId, pat.membershipId]),
    )
    // Границы перепутаны — пустой список, а не ошибка.
    expect(await list('visitsFrom=5&visitsTo=2')).toEqual([])
  })

  it('ДЕНЬ РОЖДЕНИЯ: СЕГОДНЯ, НА НЕДЕЛЕ, В ЭТОМ МЕСЯЦЕ — СВОИ ГОСТИ, СОСЕД НЕ ПОПАДАЕТ', async () => {
    expect(await list('birthday=today')).toEqual([kim.membershipId])
    expect(sorted(await list('birthday=week'))).toEqual(
      sorted([kim.membershipId, lee.membershipId]),
    )

    const month = await list('birthday=month')
    expect(month).toContain(kim.membershipId)
    expect(month).not.toContain(noi.membershipId)
    expect(month).not.toContain(stranger.membershipId)

    // Фильтры складываются: именинники недели среди постоянных.
    expect(await list('birthday=week&visitsFrom=5')).toEqual([kim.membershipId])
  })

  it('ИМЕНИННИКИ — И В РАССЫЛКЕ: ТОТ ЖЕ ЯЗЫК ФИЛЬТРОВ', async () => {
    const preview = await request(server())
      .post('/v1/admin/broadcasts/preview')
      .set('Authorization', `Bearer ${owner}`)
      .send({ audience: { birthday: 'week' } })
      .expect(200)

    expect((preview.body as { found: number }).found).toBe(2)
  })

  it('НЕИЗВЕСТНЫЙ ПОРЯДОК ИЛИ ОКНО ДНЯ РОЖДЕНИЯ — 400', async () => {
    for (const query of ['sort=random', 'birthday=year', 'visitsFrom=0']) {
      await request(server())
        .get(`/v1/admin/guests?${query}`)
        .set('Authorization', `Bearer ${manager}`)
        .expect(400)
    }
  })
})

describe('Лучшие гости за период', () => {
  it('ПО ВЫРУЧКЕ ЗА ПЕРИОД, ОТМЕНЁННЫЙ ЧЕК НЕ В СЧЁТ; МЕНЕДЖЕРУ ТЕЛЕФОН МАСКОЙ', async () => {
    await sell(cashier, kim.membershipId, 500_000)
    await sell(cashier, kim.membershipId, 400_000)
    await sell(cashier, pat.membershipId, 600_000)
    await sell(cashier, lee.membershipId, 100_000)

    // Огромный чек Ли отменён — в рейтинг он не идёт.
    const voided = await sell(cashier, lee.membershipId, 5_000_000)
    await request(server())
      .post(`/v1/pos/transactions/${voided}/void`)
      .set('Authorization', `Bearer ${cashier}`)
      .send({ reason: 'WRONG_AMOUNT' })
      .expect(200)

    const forManager = (
      await request(server())
        .get('/v1/admin/reports/top-guests?period=7d')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200)
    ).body as TopBody

    expect(forManager.period).toBe('7d')
    expect(
      forManager.guests.map((row) => [row.rank, row.membershipId, row.purchases, row.turnover]),
    ).toEqual([
      [1, kim.membershipId, 2, 900_000],
      [2, pat.membershipId, 1, 600_000],
      [3, lee.membershipId, 1, 100_000],
    ])
    expect(forManager.guests[0]?.phone).toContain('•')

    const forOwner = (
      await request(server())
        .get('/v1/admin/reports/top-guests?period=7d')
        .set('Authorization', `Bearer ${owner}`)
        .expect(200)
    ).body as TopBody

    expect(forOwner.guests[0]?.phone).toBe(kim.guestPhone)
  })

  it('КАССИРУ ОТЧЁТ ЗАКРЫТ, ПЕРИОД — ТОЛЬКО ИЗВЕСТНЫЙ, СОСЕД ВИДИТ СВОИХ', async () => {
    await request(server())
      .get('/v1/admin/reports/top-guests?period=7d')
      .set('Authorization', `Bearer ${cashier}`)
      .expect(403)

    await request(server())
      .get('/v1/admin/reports/top-guests?period=1y')
      .set('Authorization', `Bearer ${manager}`)
      .expect(400)

    const neighbourManager = signAccessToken(
      { tenantId: stranger.tenantId, actorId: null, role: 'MANAGER' },
      SECRET,
    )
    const theirs = (
      await request(server())
        .get('/v1/admin/reports/top-guests?period=7d')
        .set('Authorization', `Bearer ${neighbourManager}`)
        .expect(200)
    ).body as TopBody

    expect(theirs.guests).toEqual([])
  })
})
