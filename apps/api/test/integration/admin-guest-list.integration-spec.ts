import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Список гостей с фильтрами и выгрузка. docs/02, раздел 5.2 · docs/11, У4.
 *
 * Полигон: у ресторана лестница «Гость → Золото» и четыре гостя. Анна —
 * резидент с «Золотом», не была 40 дней. Борис — турист с «Золотом», тоже
 * спит. Вера — резидентка без «Золота», была вчера. Гриша ни разу не покупал,
 * его добавил сотрудник. У соседа — резидент с «Золотом», который спит: ловушка.
 */

const SECRET = 'admin-guest-list-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

const LADDER = [
  { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 20, hidden: false, conditions: [] },
  {
    id: 'gold',
    name: 'Золото',
    earnRate: 10,
    redeemRate: 50,
    hidden: false,
    conditions: [{ type: 'SPENT_TOTAL', gt: 100_000 }],
  },
]

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let owner: string
let manager: string
let anna: MembershipFixture
let boris: MembershipFixture
let vera: MembershipFixture
let grisha: MembershipFixture

interface ListBody {
  items: Array<{
    membershipId: string
    phone: string | null
    tier: { id: string; name: string } | null
    source: string
    firstVisitAt: string | null
  }>
  total: number
}

const server = (): Server => app.getHttpServer() as Server

const list = async (query: string, token = manager): Promise<ListBody> =>
  (
    await request(server())
      .get(`/v1/admin/guests?limit=100&${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  ).body as ListBody

const ids = (body: ListBody): string[] => body.items.map((row) => row.membershipId).sort()

const seedGuest = async (
  venue: string,
  data: {
    name: string
    mode: 'TOURIST' | 'RESIDENT'
    tierId: string | null
    lastVisitDaysAgo: number | null
    spentTotal: number
    source?: 'ORGANIC' | 'STAFF'
  },
): Promise<MembershipFixture> => {
  const fixture = await createMembershipFixture(prisma, { tenantId: venue })
  const lastVisitAt =
    data.lastVisitDaysAgo === null ? null : new Date(Date.now() - data.lastVisitDaysAgo * DAY_MS)

  await prisma.guest.update({
    where: { id: fixture.guestId },
    data: { displayName: data.name, mode: data.mode },
  })
  await prisma.membership.update({
    where: { id: fixture.membershipId },
    data: {
      tierId: data.tierId,
      lastVisitAt,
      firstVisitAt: lastVisitAt,
      visitsTotal: data.lastVisitDaysAgo === null ? 0 : 3,
      spentTotal: data.spentTotal,
      source: data.source ?? 'ORGANIC',
    },
  })

  return fixture
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

  tenantId = await createTenant(prisma)
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { tiers: LADDER } } })

  anna = await seedGuest(tenantId, {
    name: 'Анна Спящая',
    mode: 'RESIDENT',
    tierId: 'gold',
    lastVisitDaysAgo: 40,
    spentTotal: 300_000,
  })
  boris = await seedGuest(tenantId, {
    name: 'Борис Турист',
    mode: 'TOURIST',
    tierId: 'gold',
    lastVisitDaysAgo: 40,
    spentTotal: 300_000,
  })
  vera = await seedGuest(tenantId, {
    name: 'Вера Вчерашняя',
    mode: 'RESIDENT',
    tierId: 'base',
    lastVisitDaysAgo: 1,
    spentTotal: 50_000,
  })
  grisha = await seedGuest(tenantId, {
    name: 'Гриша Новый',
    mode: 'TOURIST',
    tierId: 'base',
    lastVisitDaysAgo: null,
    spentTotal: 0,
    source: 'STAFF',
  })

  const neighbour = await createTenant(prisma)
  await prisma.tenant.update({ where: { id: neighbour }, data: { settings: { tiers: LADDER } } })
  await seedGuest(neighbour, {
    name: 'Анна Соседская',
    mode: 'RESIDENT',
    tierId: 'gold',
    lastVisitDaysAgo: 40,
    spentTotal: 300_000,
  })

  owner = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  manager = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Фильтры списка гостей', () => {
  it('СПЯЩИЕ РЕЗИДЕНТЫ СО СТАТУСОМ «ЗОЛОТО» — ФИЛЬТРЫ СКЛАДЫВАЮТСЯ, СОСЕД НЕ ПОПАДАЕТ', async () => {
    const body = await list('mode=RESIDENT&tier=gold&sleeping=30')

    expect(ids(body)).toEqual([anna.membershipId])
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({
      tier: { id: 'gold', name: 'Золото' },
      source: 'ORGANIC',
    })
    expect(body.items[0]?.firstVisitAt).not.toBeNull()
  })

  it('по отдельности: турист, спящие, статус', async () => {
    expect(ids(await list('mode=TOURIST'))).toEqual(
      [boris.membershipId, grisha.membershipId].sort(),
    )
    expect(ids(await list('sleeping=30'))).toEqual([anna.membershipId, boris.membershipId].sort())
    expect(ids(await list('tier=base'))).toEqual([vera.membershipId, grisha.membershipId].sort())
  })

  it('НИ РАЗУ НЕ ПОКУПАЛИ — ТЕ, У КОГО НЕТ ВИЗИТОВ; ИСТОЧНИК — ОТКУДА ПРИШЁЛ', async () => {
    expect(ids(await list('buyers=none'))).toEqual([grisha.membershipId])
    expect(ids(await list('source=STAFF'))).toEqual([grisha.membershipId])
  })

  it('неизвестный фильтр или «спящие» меньше недели — 400', async () => {
    await request(server())
      .get('/v1/admin/guests?sleeping=3')
      .set('Authorization', `Bearer ${manager}`)
      .expect(400)
    await request(server())
      .get('/v1/admin/guests?mode=ALIEN')
      .set('Authorization', `Bearer ${manager}`)
      .expect(400)
  })

  it('СТАТУС В СПИСКЕ — КАК В КАРТОЧКЕ: ПОСЛЕ ПРАВКИ ЛЕСТНИЦЫ ПЕРЕСЧИТЫВАЕТСЯ СРАЗУ, БЕЗ ЧЕКА', async () => {
    const venue = await createTenant(prisma)
    await prisma.tenant.update({ where: { id: venue }, data: { settings: { tiers: LADDER } } })
    const guest = await seedGuest(venue, {
      name: 'Олег Порог',
      mode: 'RESIDENT',
      tierId: 'base',
      lastVisitDaysAgo: 2,
      spentTotal: 50_000,
    })
    const venueOwner = signAccessToken({ tenantId: venue, actorId: null, role: 'OWNER' }, SECRET)

    await request(server())
      .put('/v1/admin/settings/program/tiers')
      .set('Authorization', `Bearer ${venueOwner}`)
      .send({
        tiers: [LADDER[0], { ...LADDER[1], conditions: [{ type: 'SPENT_TOTAL', gt: 10_000 }] }],
        welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_FIRST_PURCHASE' },
      })
      .expect(200)

    expect(ids(await list('tier=gold', venueOwner))).toEqual([guest.membershipId])
  })
})

describe('Выгрузка гостей', () => {
  const exportGuests = (token: string, body: object) =>
    request(server())
      .post('/v1/admin/guests/export')
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  it('ВЫГРУЗКА ПО ФИЛЬТРАМ: ТЕЛЕФОНЫ МАСКОЙ ДАЖЕ ВЛАДЕЛЬЦУ, ПРИЧИНА — В АУДИТЕ', async () => {
    const response = await exportGuests(owner, {
      reason: 'Рассылка спящим резидентам к сезону',
      filters: { mode: 'RESIDENT', tier: 'gold', sleeping: 30 },
    })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')

    const csv = response.text

    expect(csv).toContain('Анна Спящая')
    expect(csv).not.toContain('Борис Турист')
    expect(csv).not.toContain('Анна Соседская')
    expect(csv).toContain(`${anna.guestPhone.slice(0, 3)} •• •• ${anna.guestPhone.slice(-4)}`)
    expect(csv).not.toContain(anna.guestPhone)

    expect(
      await prisma.auditLog.count({
        where: {
          tenantId,
          action: 'DATABASE_EXPORTED',
          reason: 'Рассылка спящим резидентам к сезону',
        },
      }),
    ).toBe(1)
  })

  it('МЕНЕДЖЕРУ — 403; БЕЗ ПРИЧИНЫ — 400; В АУДИТЕ ПУСТЫХ ВЫГРУЗОК НЕТ', async () => {
    expect((await exportGuests(manager, { reason: 'Хочу базу себе' })).status).toBe(403)
    expect((await exportGuests(owner, { reason: 'надо' })).status).toBe(400)
    expect((await exportGuests(owner, { filters: {} })).status).toBe(400)

    expect(
      await prisma.auditLog.count({
        where: { tenantId, action: 'DATABASE_EXPORTED', reason: 'надо' },
      }),
    ).toBe(0)
  })
})
