import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GrantRedeemError, OfferGrantService } from '../../src/core/offer-grant.service'
import { PrismaService } from '../../src/core/prisma.service'

/**
 * Выдача и погашение промокодов.
 *
 * ─── Что здесь сторожится и почему это важнее остальных тестов ───────────────
 *
 * Погашение промокода — это отдача товара. Дважды погашенный код означает
 * дважды отданный товар, и заведение узнаёт об этом не из лога, а из недостачи.
 *
 * Защита от этого — ОДНА строка: условие `state = ISSUED` внутри самого UPDATE.
 * Её легко «упростить» при рефакторинге до проверки перед обновлением, и на
 * тесте по одному запросу за раз разницы не будет видно вовсе. Разница видна
 * только на гонке — поэтому она здесь и проверяется.
 *
 * ─── Почему под ролью positive_app ───────────────────────────────────────────
 *
 * Промокоды лежат под RLS. Прогон под владельцем базы обошёл бы политики,
 * то есть проверил бы код в условиях, которых в боевой среде не существует, —
 * ровно так в этом проекте дважды пряталась поломка изоляции.
 *
 * Данные готовит ВЛАДЕЛЕЦ базы: заведение и гостя надо создать до того, как
 * появится контекст тенанта, а под ролью приложения без объявленного тенанта
 * не видно ничего.
 */

const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_APP_ROLE. Без него RLS не участвует, ' +
      'и проверка изоляции промокодов ничего не значит.',
  )
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
let service: OfferGrantService
let owner: Client

/** Заведение, гость и акция под него. Возвращает всё, что нужно для выдачи. */
const seed = async (options: { timeWindow?: { from: string; to: string } } = {}) => {
  const tenantId = randomUUID()
  const guestId = randomUUID()
  const offerId = randomUUID()

  await owner.query(
    `INSERT INTO "Tenant" ("id","brandName","vertical","settings")
     VALUES ($1, $2, 'RESTAURANT', '{}'::jsonb)`,
    [tenantId, `PROBE ${tenantId.slice(0, 8)}`],
  )

  await owner.query(`INSERT INTO "Guest" ("id") VALUES ($1)`, [guestId])

  await owner.query(
    `INSERT INTO "Offer" ("id","tenantId","type","status","audience","schedule","limits","reward","i18n")
     VALUES ($1, $2, 'PROMO_ON_CHECK', 'LIVE', '{}'::jsonb, $3::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
    [
      offerId,
      tenantId,
      JSON.stringify(options.timeWindow ? { timeWindow: options.timeWindow } : {}),
    ],
  )

  return { tenantId, guestId, offerId }
}

describe('Промокоды: выдача и погашение', () => {
  beforeAll(async () => {
    const previous = process.env['DATABASE_URL']
    process.env['DATABASE_URL'] = appRoleUrl()

    try {
      prisma = new PrismaService()
      await prisma.onModuleInit()
      service = new OfferGrantService(prisma)
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

  const now = new Date('2026-09-09T12:00:00.000Z')

  it('выдаёт код и запоминает срок', async () => {
    const { tenantId, guestId, offerId } = await seed()

    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    expect(grant.code.length).toBeGreaterThanOrEqual(8)
    expect(grant.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/)
    expect(grant.expiresAt.getTime()).toBe(now.getTime() + 7 * 24 * 3600 * 1000)
  })

  it('коды не повторяются', async () => {
    const { tenantId, guestId, offerId } = await seed()

    const codes = new Set<string>()

    for (let i = 0; i < 20; i += 1) {
      const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })
      codes.add(grant.code)
    }

    expect(codes.size).toBe(20)
  })

  it('гасит код и помечает, кто это сделал', async () => {
    const { tenantId, guestId, offerId } = await seed()
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    const redeemed = await service.redeem({
      code: grant.code,
      tenantId,
      redeemedBy: 'staff-1',
      now,
    })

    expect(redeemed.id).toBe(grant.id)

    const row = await owner.query<{ state: string; redeemedBy: string | null }>(
      `SELECT "state"::text, "redeemedBy" FROM "OfferGrant" WHERE "id" = $1`,
      [grant.id],
    )
    expect(row.rows[0]?.state).toBe('REDEEMED')
    expect(row.rows[0]?.redeemedBy).toBe('staff-1')
  })

  it('ВТОРОЕ ПОГАШЕНИЕ ТОГО ЖЕ КОДА ОТВЕРГАЕТСЯ', async () => {
    const { tenantId, guestId, offerId } = await seed()
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    await service.redeem({ code: grant.code, tenantId, now })

    // Молчаливый успех здесь означал бы дважды отданный товар.
    await expect(service.redeem({ code: grant.code, tenantId, now })).rejects.toMatchObject({
      code: 'GRANT_ALREADY_USED',
    })
  })

  it('ГОНКА: два кассира гасят один код одновременно — выигрывает ровно один', async () => {
    const { tenantId, guestId, offerId } = await seed()
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    // Ровно тот случай, ради которого условие state = ISSUED стоит внутри
    // UPDATE, а не в проверке перед ним. С проверкой «прочитали → обновили»
    // оба запроса увидели бы ISSUED и оба сочли бы погашение успешным.
    const results = await Promise.allSettled([
      service.redeem({ code: grant.code, tenantId, redeemedBy: 'kassir-1', now }),
      service.redeem({ code: grant.code, tenantId, redeemedBy: 'kassir-2', now }),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected')

    expect(ok, 'погасить должен ровно один кассир').toHaveLength(1)
    expect(failed).toHaveLength(1)

    const row = await owner.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "id" = $1 AND "state" = 'REDEEMED'`,
      [grant.id],
    )
    expect(Number(row.rows[0]?.n)).toBe(1)
  })

  it('истёкший код не гасится', async () => {
    const { tenantId, guestId, offerId } = await seed()
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 1, now })

    const later = new Date(now.getTime() + 2 * 24 * 3600 * 1000)

    await expect(service.redeem({ code: grant.code, tenantId, now: later })).rejects.toMatchObject({
      code: 'GRANT_EXPIRED',
    })
  })

  it('несуществующий код отвергается', async () => {
    const { tenantId } = await seed()

    await expect(service.redeem({ code: 'ZZZZZZZZZZZZ', tenantId, now })).rejects.toBeInstanceOf(
      GrantRedeemError,
    )
  })

  it('ЧУЖОЙ КОД НЕ ВИДЕН: заведение B не гасит промокод заведения A', async () => {
    const a = await seed()
    const b = await seed()

    const grant = await service.issue({
      offerId: a.offerId,
      guestId: a.guestId,
      tenantId: a.tenantId,
      validityDays: 7,
      now,
    })

    // Изоляцию обеспечивает RLS, а не проверка в коде: под тенантом B строки
    // просто не существует. Это и есть кросс-тенантная проверка, которую
    // требует Definition of Done.
    await expect(
      service.redeem({ code: grant.code, tenantId: b.tenantId, now }),
    ).rejects.toMatchObject({ code: 'GRANT_NOT_FOUND' })

    // И код остался невредим — заведение A погасит его само.
    const row = await owner.query<{ state: string }>(
      `SELECT "state"::text FROM "OfferGrant" WHERE "id" = $1`,
      [grant.id],
    )
    expect(row.rows[0]?.state).toBe('ISSUED')
  })

  it('вне окна по времени суток не гасится', async () => {
    const { tenantId, guestId, offerId } = await seed({
      timeWindow: { from: '08:00', to: '11:00' },
    })
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    // Момент заведомо вне окна: полночь по времени сервера.
    const midnight = new Date(now)
    midnight.setHours(0, 30, 0, 0)

    await expect(
      service.redeem({ code: grant.code, tenantId, now: midnight }),
    ).rejects.toMatchObject({ code: 'GRANT_OUT_OF_WINDOW' })
  })

  it('внутри окна гасится', async () => {
    const { tenantId, guestId, offerId } = await seed({
      timeWindow: { from: '00:00', to: '23:59' },
    })
    const grant = await service.issue({ offerId, guestId, tenantId, validityDays: 7, now })

    await expect(service.redeem({ code: grant.code, tenantId, now })).resolves.toBeDefined()
  })
})
