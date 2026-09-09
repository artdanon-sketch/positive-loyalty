import { randomUUID } from 'node:crypto'

import { Client, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Изоляция партнёрств: у строки ДВА хозяина, и оба должны её видеть.
 *
 * ─── Почему этому нужен отдельный тест ───────────────────────────────────────
 *
 * Все прочие таблицы принадлежат одному заведению, и политика сравнивает одну
 * колонку. Партнёрство — единственное место в базе, где условие двойное:
 *
 *     initiatorTenantId = current  ИЛИ  partnerTenantId = current
 *
 * Ошибиться в нём можно двумя способами, и оба тихие:
 *
 *   забыли вторую половину  — партнёр не видит СОБСТВЕННОГО партнёрства.
 *                             Узнаете не сразу, а когда он впервые откроет
 *                             раздел и напишет, что там пусто;
 *   написали USING (true)   — постороннее заведение видит, кто с кем
 *                             договорился и на каких условиях. Это чужая
 *                             коммерческая тайна, и утечка молчаливая.
 *
 * Проверяется поведением на живой базе под ролью positive_app: политику RLS
 * нельзя проверить, обойдя её.
 *
 * ─── Почему запросы сырые, а не через Prisma ─────────────────────────────────
 *
 * Здесь проверяется САМА политика, а не код поверх неё. Prisma добавила бы свои
 * условия в WHERE, и стало бы непонятно, кто отсёк строку — база или клиент.
 */

const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_APP_ROLE. Под владельцем базы политики RLS ' +
      'не работают, и этот тест не значил бы ничего.',
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

const connect = async (url: string): Promise<Client> => {
  const client = new Client({
    connectionString: url,
    ssl:
      url.includes('127.0.0.1') || url.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(`SET search_path TO "${schema()}"`)
  return client
}

let app: Client
let owner: Client

/** Что видит заведение, объявившее себя тенантом. */
const asTenant = async <T extends QueryResultRow>(
  tenantId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  await app.query('BEGIN')
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
  const result = await app.query<T>(sql, params)
  await app.query('ROLLBACK')
  return result.rows
}

const makeTenant = async (): Promise<string> => {
  const id = randomUUID()
  await owner.query(
    `INSERT INTO "Tenant" ("id","brandName","vertical","settings")
     VALUES ($1, $2, 'RESTAURANT', '{}'::jsonb)`,
    [id, `PROBE ${id.slice(0, 8)}`],
  )
  return id
}

describe('Партнёрство: видят обе стороны и только они', () => {
  let a = ''
  let b = ''
  let c = ''
  let partnershipId = ''
  let termId = ''

  beforeAll(async () => {
    app = await connect(appRoleUrl())
    owner = await connect(ownerUrl())

    a = await makeTenant()
    b = await makeTenant()
    c = await makeTenant()

    partnershipId = randomUUID()
    await owner.query(
      `INSERT INTO "Partnership" ("id","initiatorTenantId","partnerTenantId","status")
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [partnershipId, a, b],
    )

    termId = randomUUID()
    await owner.query(
      `INSERT INTO "PartnershipTerm"
         ("id","partnershipId","triggerTenantId","rewardTenantId","trigger","reward","limits","proposedBy","status")
       VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, 'ACTIVE')`,
      [termId, partnershipId, a, b],
    )

    await owner.query(
      `INSERT INTO "PartnershipMessage"
         ("id","partnershipId","fromTenantId","toTenantId","kind","text","sourceLang","translations")
       VALUES ($1, $2, $3, $4, 'INVITE', 'Давайте дружить заведениями', 'ru', '{}'::jsonb)`,
      [randomUUID(), partnershipId, a, b],
    )
  })

  afterAll(async () => {
    await app.end()
    await owner.end()
  })

  it('инициатор видит своё партнёрство', async () => {
    const rows = await asTenant<{ id: string }>(
      a,
      `SELECT "id" FROM "Partnership" WHERE "id" = $1`,
      [partnershipId],
    )
    expect(rows).toHaveLength(1)
  })

  it('ВТОРАЯ СТОРОНА тоже видит — забытая половина условия ломает именно это', async () => {
    const rows = await asTenant<{ id: string }>(
      b,
      `SELECT "id" FROM "Partnership" WHERE "id" = $1`,
      [partnershipId],
    )

    expect(
      rows,
      'партнёр не видит собственного партнёрства: в политике потеряна вторая половина условия',
    ).toHaveLength(1)
  })

  it('ПОСТОРОННЕЕ ЗАВЕДЕНИЕ не видит ничего', async () => {
    const rows = await asTenant<{ id: string }>(
      c,
      `SELECT "id" FROM "Partnership" WHERE "id" = $1`,
      [partnershipId],
    )

    expect(
      rows,
      'чужое заведение видит партнёрство: политика открыта шире, чем задумано',
    ).toHaveLength(0)
  })

  it('условие видят обе стороны и не видит посторонний', async () => {
    expect(
      await asTenant<{ id: string }>(a, `SELECT "id" FROM "PartnershipTerm" WHERE "id" = $1`, [
        termId,
      ]),
    ).toHaveLength(1)
    expect(
      await asTenant<{ id: string }>(b, `SELECT "id" FROM "PartnershipTerm" WHERE "id" = $1`, [
        termId,
      ]),
    ).toHaveLength(1)
    expect(
      await asTenant<{ id: string }>(c, `SELECT "id" FROM "PartnershipTerm" WHERE "id" = $1`, [
        termId,
      ]),
    ).toHaveLength(0)
  })

  it('переписку видят обе стороны и не видит посторонний', async () => {
    const sql = `SELECT "id" FROM "PartnershipMessage" WHERE "partnershipId" = $1`
    expect(await asTenant<{ id: string }>(a, sql, [partnershipId])).toHaveLength(1)
    expect(await asTenant<{ id: string }>(b, sql, [partnershipId])).toHaveLength(1)
    expect(await asTenant<{ id: string }>(c, sql, [partnershipId])).toHaveLength(0)
  })

  it('БЛОКИРОВКУ ВИДИТ ТОЛЬКО ЗАБЛОКИРОВАВШИЙ', async () => {
    await owner.query(
      `INSERT INTO "InviteBlock" ("blockerTenantId","blockedTenantId","reason")
       VALUES ($1, $2, 'спам')`,
      [a, c],
    )

    const sql = `SELECT "blockedTenantId" FROM "InviteBlock" WHERE "blockerTenantId" = $1`

    expect(await asTenant<{ blockedTenantId: string }>(a, sql, [a])).toHaveLength(1)

    // Знание «меня заблокировали» помогает блокировку обойти: сменить лицо
    // и написать снова. Поэтому заблокированный не видит даже факта.
    expect(
      await asTenant<{ blockedTenantId: string }>(c, sql, [a]),
      'заблокированное заведение видит, что его заблокировали',
    ).toHaveLength(0)
  })

  it('ПРАЙС ЧИТАЮТ ВСЕ, А ПРАВИТЬ НЕ МОЖЕТ НИКТО ИЗ ЗАВЕДЕНИЙ', async () => {
    await owner.query(
      `INSERT INTO "PartnershipPricing" ("id","freeInvitesPerDay","extraInvitePrice")
       VALUES ($1, 3, 5000) ON CONFLICT DO NOTHING`,
      [randomUUID()],
    )

    // Видеть цену заведение обязано: иначе оно не узнает, во что обойдётся
    // лишнее приглашение, до того как нажмёт кнопку.
    expect(
      (await asTenant<{ id: string }>(a, `SELECT "id" FROM "PartnershipPricing"`)).length,
    ).toBeGreaterThan(0)

    // А переписать — нет. Иначе заведение выдало бы себе тысячу бесплатных
    // приглашений. Право отобрано явно, потому что приезжает автоматически.
    await app.query('BEGIN')
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a])
    await expect(
      app.query(`UPDATE "PartnershipPricing" SET "freeInvitesPerDay" = 9999`),
    ).rejects.toThrow(/permission denied|нет прав/i)
    await app.query('ROLLBACK')
  })
})
