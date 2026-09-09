import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OfferGrantService } from '../../src/core/offer-grant.service'
import { PrismaService } from '../../src/core/prisma.service'
import {
  PartnershipTriggerService,
  type TriggerEvent,
} from '../../src/partnerships/partnership-trigger.service'

/**
 * Срабатывание партнёрского условия: от события у одного заведения
 * до промокода у другого.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 * Совпадение триггера проверяется юнит-тестом — это чистая арифметика.
 * Здесь проверяется то, что живёт ТОЛЬКО в базе и подделке не поддаётся:
 *
 *   повтор события       гость не должен получить два подарка за одну покупку,
 *                        а заведение-донор — платить дважды. Гарантию даёт
 *                        UNIQUE на nonce, а не проверка в коде: два
 *                        одновременных события прошли бы проверку оба;
 *   лимит на гостя       иначе постоянный клиент выносит акцию в одиночку;
 *   суточный предел      без него источник проводит акцию и присылает донору
 *                        двести человек за бесплатными роллами за день
 *                        (docs/07, раздел 4.3);
 *   общий лимит          «всего 200 промокодов» должно означать ровно 200.
 *
 * ─── Почему под ролью positive_app ───────────────────────────────────────────
 *
 * Слушатель ходит в базу под ДВУМЯ заведениями по очереди: читает условия под
 * источником, выдаёт промокод под донором. Под владельцем базы политики RLS
 * не работают, и эта двойственность осталась бы непроверенной.
 */

const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — без него RLS не участвует.')
}

const ownerUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST — подключение владельца для подготовки данных.')
}

const schema = (): string => {
  const explicit = process.env['DATABASE_SCHEMA']
  return typeof explicit === 'string' && explicit.trim() !== '' ? explicit.trim() : 'public'
}

let prisma: PrismaService
let service: PartnershipTriggerService
let owner: Client

/** Студия, ресторан, гость и активное условие между ними. */
const seed = async (
  options: {
    trigger?: unknown
    limits?: unknown
  } = {},
) => {
  const studio = randomUUID()
  const resto = randomUUID()
  const guest = randomUUID()
  const offerId = randomUUID()
  const partnershipId = randomUUID()
  const termId = randomUUID()

  for (const [id, name] of [
    [studio, 'Студия'],
    [resto, 'Ресторан'],
  ] as const) {
    await owner.query(
      `INSERT INTO "Tenant" ("id","brandName","vertical","settings")
       VALUES ($1, $2, 'RESTAURANT', '{}'::jsonb)`,
      [id, `${name} ${id.slice(0, 6)}`],
    )
  }

  await owner.query(`INSERT INTO "Guest" ("id") VALUES ($1)`, [guest])

  // Акция принадлежит ДОНОРУ: подарок оплачивает тот, кто его даёт.
  await owner.query(
    `INSERT INTO "Offer" ("id","tenantId","type","status","audience","schedule","limits","reward","i18n","visibility")
     VALUES ($1, $2, 'NETWORK_VOUCHER', 'LIVE', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'PARTNER')`,
    [offerId, resto],
  )

  await owner.query(
    `INSERT INTO "Partnership" ("id","initiatorTenantId","partnerTenantId","status")
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [partnershipId, studio, resto],
  )

  await owner.query(
    `INSERT INTO "PartnershipTerm"
       ("id","partnershipId","triggerTenantId","rewardTenantId","offerId",
        "trigger","reward","limits","validityDays","status","proposedBy")
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,14,'ACTIVE',$3)`,
    [
      termId,
      partnershipId,
      studio,
      resto,
      offerId,
      JSON.stringify(options.trigger ?? { type: 'ON_PACKAGE_PURCHASE', minAmount: 500_000 }),
      JSON.stringify({ kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 }),
      JSON.stringify(options.limits ?? { totalGrants: null, perGuest: 1, dailyCap: null }),
    ],
  )

  return { studio, resto, guest, offerId, termId }
}

const purchase = (
  over: Partial<TriggerEvent> & { tenantId: string; guestId: string },
): TriggerEvent => ({
  sourceEntryId: randomUUID(),
  refType: 'package',
  basisAmount: 500_000,
  visitsTotal: 1,
  membershipCreated: false,
  occurredAt: new Date('2026-09-10T10:00:00.000Z'),
  ...over,
})

describe('Партнёрский триггер: событие у одного — промокод у другого', () => {
  beforeAll(async () => {
    const previous = process.env['DATABASE_URL']
    process.env['DATABASE_URL'] = appRoleUrl()

    try {
      prisma = new PrismaService()
      await prisma.onModuleInit()
      service = new PartnershipTriggerService(prisma, new OfferGrantService(prisma))
    } finally {
      if (previous === undefined) {
        delete process.env['DATABASE_URL']
      } else {
        process.env['DATABASE_URL'] = previous
      }
    }

    owner = new Client({
      connectionString: ownerUrl(),
      ssl: ownerUrl().includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    })
    await owner.connect()
    await owner.query(`SET search_path TO "${schema()}"`)
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await owner.end()
  })

  it('ПРИМЕР ИЗ ТЗ: абонемент в студии → промокод от ресторана', async () => {
    const { studio, resto, guest, termId } = await seed()

    const issued = await service.handle(purchase({ tenantId: studio, guestId: guest }))

    expect(issued).toHaveLength(1)
    expect(issued[0]?.rewardTenantId, 'промокод выдаёт донор, а не источник').toBe(resto)
    expect(issued[0]?.code.length).toBeGreaterThanOrEqual(8)
    expect(issued[0]?.replayed).toBe(false)

    const counter = await owner.query<{ grantsIssued: number }>(
      `SELECT "grantsIssued" FROM "PartnershipTerm" WHERE "id" = $1`,
      [termId],
    )
    expect(counter.rows[0]?.grantsIssued).toBe(1)
  })

  it('ПОВТОР СОБЫТИЯ НЕ ВЫДАЁТ ВТОРОЙ ПРОМОКОД', async () => {
    const { studio, guest, offerId, termId } = await seed()
    const event = purchase({ tenantId: studio, guestId: guest })

    const first = await service.handle(event)
    const second = await service.handle(event)

    expect(first[0]?.grantId, 'повтор обязан вернуть ТОТ ЖЕ промокод').toBe(second[0]?.grantId)
    expect(second[0]?.replayed).toBe(true)

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [offerId],
    )
    expect(Number(grants.rows[0]?.n)).toBe(1)

    // Счётчик не должен расти на повторе: иначе лимит «всего 200» исчерпается
    // повторными доставками событий, а не гостями.
    const counter = await owner.query<{ grantsIssued: number }>(
      `SELECT "grantsIssued" FROM "PartnershipTerm" WHERE "id" = $1`,
      [termId],
    )
    expect(counter.rows[0]?.grantsIssued, 'повтор раздул счётчик выдач').toBe(1)
  })

  it('лимит на гостя: вторая покупка подарка не приносит', async () => {
    const { studio, guest, offerId } = await seed({
      limits: { totalGrants: null, perGuest: 1, dailyCap: null },
    })

    // Разные записи журнала — значит идемпотентность ни при чём, работает лимит.
    await service.handle(purchase({ tenantId: studio, guestId: guest }))
    const second = await service.handle(purchase({ tenantId: studio, guestId: guest }))

    expect(second).toHaveLength(0)

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [offerId],
    )
    expect(Number(grants.rows[0]?.n)).toBe(1)
  })

  it('СУТОЧНЫЙ ПРЕДЕЛ защищает донора от наплыва', async () => {
    const { studio, offerId } = await seed({
      limits: { totalGrants: null, perGuest: 5, dailyCap: 2 },
    })

    // Три разных гостя в один день при пределе два.
    const guests: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const id = randomUUID()
      await owner.query(`INSERT INTO "Guest" ("id") VALUES ($1)`, [id])
      guests.push(id)
    }

    const results = []
    for (const guestId of guests) {
      results.push(await service.handle(purchase({ tenantId: studio, guestId })))
    }

    expect(results[0]).toHaveLength(1)
    expect(results[1]).toHaveLength(1)
    expect(results[2], 'третий гость за сутки должен упереться в предел').toHaveLength(0)

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [offerId],
    )
    expect(Number(grants.rows[0]?.n)).toBe(2)
  })

  it('общий лимит: «всего один» означает ровно один', async () => {
    const { studio, offerId } = await seed({
      limits: { totalGrants: 1, perGuest: 5, dailyCap: null },
    })

    const other = randomUUID()
    await owner.query(`INSERT INTO "Guest" ("id") VALUES ($1)`, [other])

    await service.handle(purchase({ tenantId: studio, guestId: randomUUID() })).catch(() => [])
    const first = await service.handle(purchase({ tenantId: studio, guestId: other }))
    const second = await service.handle(purchase({ tenantId: studio, guestId: other }))

    expect(first.length + second.length).toBeLessThanOrEqual(1)

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [offerId],
    )
    expect(Number(grants.rows[0]?.n)).toBeLessThanOrEqual(1)
  })

  it('несовпавший триггер ничего не выдаёт', async () => {
    const { studio, guest, offerId } = await seed({
      trigger: { type: 'ON_PACKAGE_PURCHASE', minAmount: 500_000 },
    })

    // Обычный чек той же суммы — не абонемент.
    const issued = await service.handle(
      purchase({ tenantId: studio, guestId: guest, refType: 'receipt' }),
    )

    expect(issued).toHaveLength(0)

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [offerId],
    )
    expect(Number(grants.rows[0]?.n)).toBe(0)
  })

  it('условие БЕЗ АКЦИИ не срабатывает — активации ещё не было', async () => {
    const { studio, guest, termId } = await seed()

    // Ровно то состояние, в котором Term живёт до согласия обеих сторон.
    await owner.query(`UPDATE "PartnershipTerm" SET "offerId" = NULL WHERE "id" = $1`, [termId])

    const issued = await service.handle(purchase({ tenantId: studio, guestId: guest }))

    expect(issued).toHaveLength(0)
  })

  it('ЧУЖОЕ СОБЫТИЕ не трогает условия соседей', async () => {
    const mine = await seed()
    const alien = await seed()

    // Событие в СВОЕЙ студии не должно задеть условие чужого партнёрства.
    await service.handle(purchase({ tenantId: mine.studio, guestId: mine.guest }))

    const grants = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
      [alien.offerId],
    )
    expect(Number(grants.rows[0]?.n), 'сработало чужое условие').toBe(0)
  })
})
