import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PlatformPrismaService } from '../../src/platform/platform-prisma.service'
import { PlatformStatsService } from '../../src/platform/platform-stats.service'

/**
 * Цифры на главном экране панели.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 * Панель владельца платформы — место, где решения принимают по числам. Число,
 * посчитанное неверно, хуже отсутствующего: отсутствующее заметят, неверному
 * поверят. Поэтому подсчёт проверяется на данных, которые тест кладёт сам
 * и знает наперёд, а не на том, что случайно оказалось в базе.
 *
 * ─── Почему ДВА подключения ──────────────────────────────────────────────────
 *
 * Проверяемый запрос идёт ролью positive_platform: он обязан видеть ВСЕ
 * заведения сразу — ровно то, что запрещено остальной системе. Прогон под
 * владельцем базы обошёл бы и права, и RLS, то есть проверил бы код в
 * условиях, которых в боевой среде не существует.
 *
 * А вот ДАННЫЕ для проверки кладёт владелец базы, и это не удобство. Роль
 * платформы по данным заведений имеет только SELECT: писать в Tenant и
 * Membership ей нельзя (миграция 20260909140000). Первая версия этого теста
 * создавала заведения ею же — и упала бы на правах. Отказ был бы правильным:
 * панель смотрит, а не правит.
 */

const platformUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_PLATFORM_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_PLATFORM_ROLE. Без него подсчёт по всем ' +
      'заведениям не проверяется: обычной роли они не видны.',
  )
}

const ownerUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST — подключение владельца базы для подготовки данных.')
}

let prisma: PlatformPrismaService
let stats: PlatformStatsService
/** Владелец базы: только чтобы положить и убрать данные проверки. */
let owner: Client

/** Заведения, созданные этим прогоном. Узнаём их по метке в названии. */
const MARK = `PROBE-STATS-${process.pid}`
const createdTenantIds: string[] = []

const createTenant = async (brandName: string): Promise<string> => {
  const result = await owner.query<{ id: string }>(
    `INSERT INTO "Tenant" ("id", "brandName", "vertical", "settings", "status")
     VALUES (gen_random_uuid(), $1, 'RESTAURANT', '{}'::jsonb, 'ACTIVE')
     RETURNING "id"`,
    [`${MARK} ${brandName}`],
  )

  const id = result.rows[0]?.id ?? ''
  createdTenantIds.push(id)
  return id
}

describe('Подсчёт по всем заведениям', () => {
  beforeAll(async () => {
    const previous = process.env['DATABASE_URL_PLATFORM']
    process.env['DATABASE_URL_PLATFORM'] = platformUrl()

    try {
      prisma = new PlatformPrismaService()
      await prisma.onModuleInit()
      stats = new PlatformStatsService(prisma)

      const url = ownerUrl()
      owner = new Client({
        connectionString: url,
        ssl:
          url.includes('127.0.0.1') || url.includes('localhost')
            ? false
            : { rejectUnauthorized: false },
      })
      await owner.connect()
      await owner.query(`SET search_path TO "${process.env['DATABASE_SCHEMA'] ?? 'public'}"`)
    } finally {
      if (previous === undefined) {
        delete process.env['DATABASE_URL_PLATFORM']
      } else {
        process.env['DATABASE_URL_PLATFORM'] = previous
      }
    }
  })

  afterAll(async () => {
    // Убираем за собой ровно свои строки: чужие данные в общей базе не трогаем.
    // Владельцем базы — у роли платформы права удалять нет и быть не должно.
    for (const id of createdTenantIds) {
      await owner.query('DELETE FROM "Membership" WHERE "tenantId" = $1', [id])
      await owner.query('DELETE FROM "Tenant" WHERE "id" = $1', [id])
    }

    await owner.end()
    await prisma.$disconnect()
  })

  it('видит заведение БЕЗ участий и не падает на пустых суммах', async () => {
    const id = await createTenant('пустое')

    const result = await stats.tenants(new Date())
    const row = result.tenants.find((tenant) => tenant.id === id)

    // Пустое заведение обязано быть В СПИСКЕ с нулями, а не пропасть из него.
    // Пропажа означала бы INNER JOIN вместо LEFT: новое заведение,
    // у которого ещё нет ни одного гостя, исчезло бы с экрана.
    expect(row, 'заведение без участий пропало из списка').toBeDefined()
    expect(row?.guests).toBe(0)
    expect(row?.spentTotal).toBe(0)
    expect(row?.lastVisitAt).toBeNull()
  })

  it('складывает участия, обороты и баллы того заведения, к которому они относятся', async () => {
    const mine = await createTenant('со счётом')
    const other = await createTenant('соседнее')

    const guests = (await owner.query<{ id: string }>('SELECT "id" FROM "Guest" LIMIT 2')).rows

    if (guests.length < 2) {
      // Гостей в базе меньше двух — сложить нечего. Молча пропустить проверку
      // хуже, чем сказать вслух: зелёный тест без проверки вводит в заблуждение.
      throw new Error('В базе меньше двух гостей: проверку сложения выполнить не на чем.')
    }

    await owner.query(
      `INSERT INTO "Membership" ("id","tenantId","guestId","pointsBalance","spentTotal","visitsTotal")
       VALUES
         (gen_random_uuid(), $1, $3, 500, 120000, 3),
         (gen_random_uuid(), $1, $4, 250, 80000, 2),
         (gen_random_uuid(), $2, $3, 999, 999999, 9)`,
      [mine, other, guests[0]?.id, guests[1]?.id],
    )

    const result = await stats.tenants(new Date())
    const row = result.tenants.find((tenant) => tenant.id === mine)

    expect(row?.guests).toBe(2)
    expect(row?.spentTotal, 'обороты сложены').toBe(200_000)
    expect(row?.pointsOutstanding, 'баллы сложены').toBe(750)
    expect(row?.visits).toBe(5)

    // Главное: цифры СОСЕДНЕГО заведения не подмешались. Ошибка в группировке
    // дала бы правдоподобную сумму, в которой лежит чужая выручка.
    expect(row?.spentTotal).not.toBe(1_199_999)
  })

  it('сводка сходится со слагаемыми', async () => {
    const result = await stats.tenants(new Date())

    const sumGuests = result.tenants.reduce((sum, tenant) => sum + tenant.guests, 0)
    const sumSpent = result.tenants.reduce((sum, tenant) => sum + tenant.spentTotal, 0)

    // Несходящаяся сводка — верный способ отучить владельца верить панели.
    expect(result.totals.tenants).toBe(result.tenants.length)
    expect(result.totals.guests).toBe(sumGuests)
    expect(result.totals.spentTotal).toBe(sumSpent)
  })

  it('деньги приходят целыми числами, а не дробью', async () => {
    const result = await stats.tenants(new Date())

    // Железное правило 4: суммы — целые в минорных единицах. Дробь здесь
    // означала бы, что где-то делили на сто раньше времени.
    for (const tenant of result.tenants) {
      expect(Number.isInteger(tenant.spentTotal), `${tenant.brandName}: оборот не целый`).toBe(true)
      expect(Number.isInteger(tenant.pointsOutstanding)).toBe(true)
    }
  })
})
