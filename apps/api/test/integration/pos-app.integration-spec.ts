import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PosConfig, PosHistory, PosInvite, PosMe, ProgramSettings } from '@positive/contracts'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { resetEnvCache } from '../../src/common/config/env'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant, idempotencyKey } from './ledger-test-context'

/**
 * Приложение кассира: пригласить, своя история, профиль. docs/02, раздел 3.9.
 *
 * Полигон: в нашем заведении кассиры Анна и Борис. У Анны сегодня два чека
 * и третий, отменённый; ещё три пробиты раньше — три дня, двадцать и сорок
 * дней назад. У Бориса свой чек сегодня. По соседству — заведение с кассиром
 * Верой и её единственным чеком.
 *
 * Главное, что проверяется:
 *   • история и показатели закрыты, пока владелец не открыл их в настройках,
 *     и открываются именно с экрана настроек — запись и чтение настройки
 *     проходят весь путь до кассы;
 *   • кассир видит только свои чеки — ни коллеги, ни соседнего заведения;
 *   • итог считается как в отчётах владельца: отменённый чек не в счёт,
 *     и итог берётся по всему периоду, а не по видимой части списка.
 */

const SECRET = 'pos-app-secret-not-used-anywhere-else'
const GUEST_URL = 'https://card.pos-app.test'
const ZONE = 'Asia/Bangkok'
const DAY_MS = 24 * 60 * 60 * 1000

interface Person {
  readonly id: string
  readonly token: string
}

interface Venue {
  readonly tenantId: string
  readonly brandName: string
  readonly owner: string
}

interface ErrorBody {
  error: { code: string; details?: { fields?: string[] } }
}

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let previousGuestUrl: string | undefined

let ours: Venue
let neighbour: Venue
let anna: Person
let boris: Person
let vera: Person

/** Чеки Анны: сегодняшние и пробитые раньше. */
let annaFirst: string
let annaSecond: string
let annaVoided: string
let annaThreeDaysAgo: string
let annaTwentyDaysAgo: string
let veraCheck: string

const server = (): Server => app.getHttpServer() as Server

const get = (path: string, token: string): request.Test =>
  request(server()).get(path).set('Authorization', `Bearer ${token}`)

/** Дата по календарю заведения `daysAgo` дней назад. */
const localDay = (daysAgo: number): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - daysAgo * DAY_MS))

const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS)

const pause = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const venue = async (tenantId: string): Promise<Venue> => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { brandName: true },
  })

  return {
    tenantId,
    brandName: tenant.brandName,
    owner: signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET),
  }
}

const cashier = async (tenantId: string, displayName: string): Promise<Person> => {
  const row = await prisma.staff.create({
    data: { tenantId, displayName, role: 'CASHIER' },
    select: { id: true },
  })

  return {
    id: row.id,
    token: signAccessToken({ tenantId, actorId: row.id, role: 'CASHIER' }, SECRET),
  }
}

interface CheckInput {
  readonly tenantId: string
  readonly membershipId: string
  readonly actorId: string
  /** Сумма чека в сатангах. */
  readonly basis: number
  /** Когда чек пробили, если не сейчас: он долежал в очереди планшета без связи. */
  readonly occurredAt?: Date
}

/** Чек с кассы — так, как его пишет pos.service: начисление по чеку от имени кассира. */
const check = async (input: CheckInput): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId: input.membershipId,
      amount: Math.round(input.basis / 20),
      basisAmount: input.basis,
      idempotencyKey: idempotencyKey('pos-app'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt.toISOString() }),
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId: input.actorId,
    },
    { tenantId: input.tenantId },
  )

  return result.entry.id
}

const voidCheck = async (tenantId: string, entryId: string, actorId: string): Promise<void> => {
  await ledger.reverse(
    {
      entryId,
      idempotencyKey: idempotencyKey('pos-app-void'),
      reason: 'RECEIPT_VOIDED',
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId,
    },
    { tenantId },
  )
}

/** Владелец меняет экран кассира — тем же входом, что и экран настроек бэк-офиса. */
const setRules = async (
  owner: string,
  rules: { showOwnHistory?: boolean; showOwnStats?: boolean; allowInvite?: boolean },
): Promise<void> => {
  await request(server())
    .put('/v1/admin/settings/program')
    .set('Authorization', `Bearer ${owner}`)
    .send({
      baseEarnRate: 5,
      baseRedeemRate: 30,
      cashierRules: {
        requireReceiptNumber: false,
        maxManualAmount: null,
        allowManualEntry: true,
        ...rules,
      },
    })
    .expect(200)
}

const history = async (token: string, query = ''): Promise<PosHistory> => {
  const response = await get(`/v1/pos/history${query}`, token).expect(200)
  return response.body as PosHistory
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET
  previousGuestUrl = process.env['GUEST_APP_URL']
  process.env['GUEST_APP_URL'] = GUEST_URL
  resetEnvCache()

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)

  // ─── Наше заведение ──────────────────────────────────────────────────────
  const maria = await createMembershipFixture(prisma)
  const nameless = await createMembershipFixture(prisma, { tenantId: maria.tenantId })
  await prisma.guest.update({ where: { id: maria.guestId }, data: { displayName: 'Мария' } })

  ours = await venue(maria.tenantId)
  anna = await cashier(ours.tenantId, 'Анна')
  boris = await cashier(ours.tenantId, 'Борис')

  const at = { tenantId: ours.tenantId, actorId: anna.id }

  annaFirst = await check({ ...at, membershipId: maria.membershipId, basis: 50_000 })
  annaSecond = await check({ ...at, membershipId: nameless.membershipId, basis: 30_000 })
  annaVoided = await check({ ...at, membershipId: maria.membershipId, basis: 20_000 })
  await voidCheck(ours.tenantId, annaVoided, anna.id)

  annaThreeDaysAgo = await check({
    ...at,
    membershipId: maria.membershipId,
    basis: 70_000,
    occurredAt: daysAgo(3),
  })
  annaTwentyDaysAgo = await check({
    ...at,
    membershipId: nameless.membershipId,
    basis: 90_000,
    occurredAt: daysAgo(20),
  })
  const annaFortyDaysAgo = await check({
    ...at,
    membershipId: maria.membershipId,
    basis: 10_000,
    occurredAt: daysAgo(40),
  })

  const borisCheck = await check({
    tenantId: ours.tenantId,
    actorId: boris.id,
    membershipId: maria.membershipId,
    basis: 99_000,
  })

  // Оценки: Анне за месяц 5, 4 и 4 — в среднем 4,3. Старая единица и единица
  // Борису в её оценку попасть не должны.
  const review = async (
    ledgerEntryId: string,
    staffId: string,
    rating: number,
    createdAt = new Date(),
  ): Promise<void> => {
    await prisma.review.create({
      data: {
        tenantId: ours.tenantId,
        guestId: maria.guestId,
        ledgerEntryId,
        staffId,
        rating,
        createdAt,
      },
    })
  }

  await review(annaFirst, anna.id, 5)
  await review(annaSecond, anna.id, 4)
  await review(annaThreeDaysAgo, anna.id, 4)
  await review(annaFortyDaysAgo, anna.id, 1, daysAgo(40))
  await review(borisCheck, boris.id, 1)

  // Источники: выключенный старый, затем табличка, затем Instagram.
  const channel = async (
    tenantId: string,
    name: string,
    code: string,
    isActive: boolean,
    minutesAgo: number,
  ): Promise<void> => {
    await prisma.acquisitionChannel.create({
      data: {
        tenantId,
        name,
        code,
        isActive,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    })
  }

  await channel(ours.tenantId, 'Старая листовка', 'PAPER234', false, 30)
  await channel(ours.tenantId, 'Табличка на стойке', 'STAND234', true, 20)
  await channel(ours.tenantId, 'Instagram', 'GRAMXY23', true, 10)

  // ─── Соседнее заведение ─────────────────────────────────────────────────
  const stranger = await createMembershipFixture(prisma)
  neighbour = await venue(stranger.tenantId)
  vera = await cashier(neighbour.tenantId, 'Вера')
  veraCheck = await check({
    tenantId: neighbour.tenantId,
    actorId: vera.id,
    membershipId: stranger.membershipId,
    basis: 15_000,
  })
  await channel(neighbour.tenantId, 'Соседская табличка', 'NEXTD234', true, 5)
})

afterAll(async () => {
  await app.close()

  if (previousGuestUrl === undefined) {
    delete process.env['GUEST_APP_URL']
  } else {
    process.env['GUEST_APP_URL'] = previousGuestUrl
  }
  resetEnvCache()
})

describe('Касса: пригласить гостя', () => {
  it('QR ВЕДЁТ В ПЕРВЫЙ ВКЛЮЧЁННЫЙ ИСТОЧНИК, И КАССИР ВИДИТ, КУДА ЗАПИШЕТСЯ ГОСТЬ', async () => {
    const response = await get('/v1/pos/invite', anna.token).expect(200)

    // Выключенная листовка старше, но гостя в неё не записать.
    expect(response.body as PosInvite).toEqual({
      code: 'STAND234',
      source: 'Табличка на стойке',
      url: `${GUEST_URL}/?venue=${ours.tenantId}&src=STAND234`,
    })
  })

  it('У СОСЕДА СВОЙ QR — НАШ ИСТОЧНИК ЕМУ НЕ ДОСТАЁТСЯ', async () => {
    const response = await get('/v1/pos/invite', vera.token).expect(200)

    expect(response.body as PosInvite).toEqual({
      code: 'NEXTD234',
      source: 'Соседская табличка',
      url: `${GUEST_URL}/?venue=${neighbour.tenantId}&src=NEXTD234`,
    })
  })

  it('ИСТОЧНИКОВ НЕТ ВОВСЕ — ПЕРВЫЙ QR САМ ЗАВОДИТ «СТОЙКУ КАССЫ», ОДНУ НА ДВЕ КАССЫ', async () => {
    // У только что подключённого заведения: как у UDS, QR есть с первого дня.
    const tenantId = await createTenant(prisma)
    const token = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET)

    // Две кассы открыли вкладку одновременно — источник один.
    const [first, second] = await Promise.all([
      get('/v1/pos/invite', token).expect(200),
      get('/v1/pos/invite', token).expect(200),
    ])
    const invite = first.body as PosInvite

    expect(invite.source).toBe('Стойка кассы')
    expect(invite.code).toMatch(/^[A-Z0-9]{8}$/)
    expect(invite.url).toBe(`${GUEST_URL}/?venue=${tenantId}&src=${invite.code ?? ''}`)
    expect(second.body as PosInvite).toEqual(invite)

    const channels = await prisma.acquisitionChannel.count({ where: { tenantId } })
    expect(channels).toBe(1)

    // И дальше — тот же QR, а не новый на каждое открытие.
    expect((await get('/v1/pos/invite', token).expect(200)).body as PosInvite).toEqual(invite)
  })

  it('ВЛАДЕЛЕЦ ВЫКЛЮЧИЛ ВСЕ ИСТОЧНИКИ — ПОЛЯ ПУСТЫЕ, КАССА ЕГО РЕШЕНИЕ НЕ ОБХОДИТ', async () => {
    const tenantId = await createTenant(prisma)
    const token = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET)
    await prisma.acquisitionChannel.create({
      data: { tenantId, name: 'Старая листовка', code: 'OLDFLY23', isActive: false },
    })

    const response = await get('/v1/pos/invite', token).expect(200)

    expect(response.body as PosInvite).toEqual({ code: null, url: null, source: null })
    expect(await prisma.acquisitionChannel.count({ where: { tenantId } })).toBe(1)
  })

  it('ВЛАДЕЛЕЦ ЗАПРЕТИЛ — ОТКАЗ, И КАССА ЗНАЕТ ОБ ЭТОМ ЗАРАНЕЕ', async () => {
    await setRules(ours.owner, { allowInvite: false })

    const response = await get('/v1/pos/invite', anna.token).expect(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')

    // Вкладка, ведущая в отказ, хуже отсутствующей: касса узнаёт правило до того,
    // как нарисует вкладку.
    const config = await get('/v1/pos/config', anna.token).expect(200)
    expect((config.body as PosConfig).allowInvite).toBe(false)

    await setRules(ours.owner, { allowInvite: true })
    await get('/v1/pos/invite', anna.token).expect(200)
  })
})

describe('Касса: своя история', () => {
  it('ПОКА ВЛАДЕЛЕЦ НЕ ОТКРЫЛ — ОТКАЗ: ВЫРУЧКА ПО ЧАСАМ НЕ ДЛЯ ВСЕХ', async () => {
    const response = await get('/v1/pos/history', anna.token).expect(403)

    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('ВЛАДЕЛЕЦ ОТКРЫЛ НА ЭКРАНЕ НАСТРОЕК — ГАЛОЧКА СОХРАНИЛАСЬ, И КАССА ОБ ЭТОМ УЗНАЛА', async () => {
    await setRules(ours.owner, { showOwnHistory: true })

    // Экран настроек обязан увидеть сохранённое — иначе галочка «слетает»
    // при каждом открытии, и владелец не понимает, включено ли.
    const settings = await get('/v1/admin/settings/program', ours.owner).expect(200)
    expect((settings.body as ProgramSettings).cashierRules).toMatchObject({
      showOwnHistory: true,
      showOwnStats: false,
      allowInvite: true,
    })

    const config = await get('/v1/pos/config', anna.token).expect(200)
    expect(config.body as PosConfig).toMatchObject({
      showOwnHistory: true,
      showOwnStats: false,
      allowInvite: true,
    })
  })

  it('ЗА СЕГОДНЯ — ТОЛЬКО СВОИ ЧЕКИ, НОВЫЕ СВЕРХУ: ЧЕК БОРИСА АННЕ НЕ ВИДЕН', async () => {
    const body = await history(anna.token)

    expect(body.items.map((item) => item.id)).toEqual([annaVoided, annaSecond, annaFirst])
    // Имени нет — null, а подпись «без имени» рисует касса на своём языке.
    expect(body.items.map((item) => item.guest)).toEqual(['Мария', null, 'Мария'])
    expect(body.items.map((item) => item.amount)).toEqual([20_000, 30_000, 50_000])
    expect(body.items.map((item) => item.points)).toEqual([1_000, 1_500, 2_500])
  })

  it('ОТМЕНЁННЫЙ ЧЕК ВИДЕН С ПОМЕТКОЙ, НО НЕ ВХОДИТ НИ В ИТОГ, НИ В ЧИСЛО ЧЕКОВ', async () => {
    const body = await history(anna.token, '?period=today')

    expect(body.items.map((item) => item.reversed)).toEqual([true, false, false])
    // Как в отчётах владельца: 500 ฿ + 300 ฿, отменённые 200 ฿ не в счёт.
    expect(body.total).toBe(80_000)
    expect(body.count).toBe(2)
    expect(body.hasMore).toBe(false)
  })

  it('НЕДЕЛЯ, МЕСЯЦ И СВОИ ДАТЫ СЧИТАЮТСЯ ПО КАЛЕНДАРЮ ЗАВЕДЕНИЯ', async () => {
    const week = await history(anna.token, '?period=week')
    expect(week.items.map((item) => item.id)).toContain(annaThreeDaysAgo)
    expect(week.items.map((item) => item.id)).not.toContain(annaTwentyDaysAgo)
    expect(week.total).toBe(150_000)
    expect(week.count).toBe(3)

    // Чек сорокадневной давности в месяц не входит.
    const month = await history(anna.token, '?period=month')
    expect(month.items).toHaveLength(5)
    expect(month.total).toBe(240_000)
    expect(month.count).toBe(4)

    const range = await history(anna.token, `?period=range&from=${localDay(20)}&to=${localDay(3)}`)
    expect(range.items.map((item) => item.id)).toEqual([annaThreeDaysAgo, annaTwentyDaysAgo])
    expect(range.total).toBe(160_000)
  })

  it('ЧЕК С ПЛАНШЕТА БЕЗ СВЯЗИ ВСТАЁТ В СПИСОК ПО ВРЕМЕНИ, КОГДА ЕГО ПРОБИЛИ', async () => {
    // Чек дошёл позже, чем его пробили: время записи у него новее времени
    // события. В списке он обязан встать между соседями по времени события,
    // а не уехать в конец только потому, что у живых чеков события нет.
    const dasha = await cashier(ours.tenantId, 'Даша')
    const membership = await createMembershipFixture(prisma, { tenantId: ours.tenantId })
    const at = { tenantId: ours.tenantId, actorId: dasha.id, membershipId: membership.membershipId }

    const early = await check({ ...at, basis: 10_000 })
    await pause(20)
    const punchedAt = new Date()
    await pause(20)
    const queued = await check({ ...at, basis: 20_000, occurredAt: punchedAt })
    await pause(20)
    const late = await check({ ...at, basis: 30_000 })

    const body = await history(dasha.token)

    expect(body.items.map((item) => item.id)).toEqual([late, queued, early])
    expect(body.items[1]?.occurredAt).toBe(punchedAt.toISOString())
  })

  it('ЗА ДЛИННЫЙ ПЕРИОД ИТОГ — ПО ВСЕМ ЧЕКАМ, А НЕ ПО ВИДИМЫМ В СПИСКЕ', async () => {
    // У занятого кассира за месяц чеков больше, чем помещается в список.
    // Итог по видимой части занизил бы выручку — и кассир не сошёлся бы с кассой.
    const gleb = await cashier(ours.tenantId, 'Глеб')
    const membership = await createMembershipFixture(prisma, { tenantId: ours.tenantId })

    for (let index = 0; index < 201; index += 1) {
      await check({
        tenantId: ours.tenantId,
        actorId: gleb.id,
        membershipId: membership.membershipId,
        basis: 1_000,
      })
    }

    const body = await history(gleb.token, '?period=month')

    expect(body.items).toHaveLength(200)
    expect(body.hasMore).toBe(true)
    expect(body.count).toBe(201)
    expect(body.total).toBe(201_000)
  })

  it('НЕВЕРНЫЙ ПЕРИОД — 400, А НЕ ПУСТАЯ СМЕНА', async () => {
    // Пустой список кассир принял бы за пустую смену.
    const noDates = await get('/v1/pos/history?period=range', anna.token).expect(400)
    expect((noDates.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')

    const reversed = await get(
      `/v1/pos/history?period=range&from=${localDay(3)}&to=${localDay(20)}`,
      anna.token,
    ).expect(400)
    expect((reversed.body as ErrorBody).error.details?.fields).toContain('to')

    await get('/v1/pos/history?period=year', anna.token).expect(400)
    await get('/v1/pos/history?tenantId=whatever', anna.token).expect(400)
  })

  it('СЕССИЯ БЕЗ СОТРУДНИКА ВИДИТ ПУСТОЙ СПИСОК, А НЕ ЧУЖИЕ ЧЕКИ', async () => {
    const token = signAccessToken(
      { tenantId: ours.tenantId, actorId: null, role: 'CASHIER' },
      SECRET,
    )

    expect(await history(token)).toEqual({ items: [], total: 0, count: 0, hasMore: false })
  })

  it('СОСЕД ВИДИТ ТОЛЬКО СВОЁ, А ЕГО КАССИР С НАШИМ ЗАВЕДЕНИЕМ В ТОКЕНЕ НЕ ПРОХОДИТ', async () => {
    await setRules(neighbour.owner, { showOwnHistory: true })

    const body = await history(vera.token, '?period=month')
    expect(body.items.map((item) => item.id)).toEqual([veraCheck])
    expect(body.total).toBe(15_000)

    // Подпись верная, но Веры в нашем заведении нет: такой токен — не сотрудник.
    const forged = signAccessToken(
      { tenantId: ours.tenantId, actorId: vera.id, role: 'CASHIER' },
      SECRET,
    )
    await get('/v1/pos/history', forged).expect(401)
  })
})

describe('Касса: профиль', () => {
  it('ПОКАЗАТЕЛИ ЗАКРЫТЫ — ИМЯ, РОЛЬ И ЗАВЕДЕНИЕ ЕСТЬ, ЦИФР НЕТ', async () => {
    const response = await get('/v1/pos/me', anna.token).expect(200)

    expect(response.body as PosMe).toEqual({
      displayName: 'Анна',
      role: 'CASHIER',
      venue: ours.brandName,
      stats: null,
    })
  })

  it('ОТКРЫТЫ — ВЫРУЧКА СМЕНЫ БЕЗ ОТМЕНЁННЫХ И ЧУЖИХ ЧЕКОВ, ОЦЕНКА ЗА МЕСЯЦ', async () => {
    await setRules(ours.owner, { showOwnStats: true })

    const response = await get('/v1/pos/me', anna.token).expect(200)

    // Смена — сегодняшние 500 ฿ и 300 ฿. Оценка — 5, 4 и 4 за месяц: 4,3.
    // Старая единица и единица Борису в неё не попадают.
    expect((response.body as PosMe).stats).toEqual({
      shiftRevenue: 80_000,
      shiftCount: 2,
      rating: 4.3,
    })
  })

  it('НОВЫЙ КАССИР БЕЗ ОЦЕНОК — ОЦЕНКИ НЕТ, А НЕ НОЛЬ', async () => {
    // Ноль звёзд читается как «гости недовольны», а их просто ещё не было.
    const egor = await cashier(ours.tenantId, 'Егор')

    const response = await get('/v1/pos/me', egor.token).expect(200)

    expect((response.body as PosMe).stats).toEqual({ shiftRevenue: 0, shiftCount: 0, rating: null })
  })

  it('СОСЕД ВИДИТ СВОЮ ВЫВЕСКУ, А СВОИ ЦИФРЫ — ТОЛЬКО ЕСЛИ ОТКРЫЛ ЕГО ВЛАДЕЛЕЦ', async () => {
    const response = await get('/v1/pos/me', vera.token).expect(200)

    // Наш владелец открыл показатели своим кассирам, а не соседским.
    expect(response.body as PosMe).toEqual({
      displayName: 'Вера',
      role: 'CASHIER',
      venue: neighbour.brandName,
      stats: null,
    })

    const forged = signAccessToken(
      { tenantId: ours.tenantId, actorId: vera.id, role: 'CASHIER' },
      SECRET,
    )
    await get('/v1/pos/me', forged).expect(401)
  })
})
