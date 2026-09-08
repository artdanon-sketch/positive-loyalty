/**
 * ТЕСТ-СТРАЖ: границы роли positive_platform.
 *
 * ─── Что это за роль ─────────────────────────────────────────────────────────
 *
 * Вторая роль базы, появившаяся в миграции 20260909140000. Ею будет ходить
 * ОТДЕЛЬНОЕ приложение админки платформы, и только оно. Ей позволено то, что
 * запрещено всей остальной системе: читать данные ВСЕХ заведений сразу.
 *
 * Именно поэтому её границы нуждаются в стороже больше, чем что-либо ещё в
 * репозитории. Обычная роль ошибается в сторону «не вижу своего» — это отказ,
 * его замечают в тот же день. Эта ошибается в сторону «вижу чужое», и заметить
 * такое нечем: данные просто текут, а всё зелено.
 *
 * ─── Что здесь проверяется, и почему именно это ──────────────────────────────
 *
 * Три границы, каждая из которых держится на одной строке миграции:
 *
 *   1. Кросс-тенантное чтение РАБОТАЕТ. Без него панель бессмысленна, и если
 *      политики platform_reads_all потеряются, надо узнать об этом здесь.
 *   2. Личные данные НЕ ВЫДАНЫ. Права на Guest и Staff выданы ПОКОЛОНОЧНО:
 *      телефон, имя и день рождения гостя не выданы, pinHash сотрудника — тем
 *      более. Поколоночный GRANT легко потерять при рефакторинге миграций,
 *      заменив его на обычный GRANT SELECT ON TABLE, — и никто не заметит.
 *   3. Роль НИЧЕГО НЕ ПИШЕТ по данным заведений. Панель смотрит, а не правит.
 *
 * ─── Почему нужны ДВА соединения ─────────────────────────────────────────────
 *
 * Половина смысла этой миграции в том, что она НЕ ТРОГАЕТ обычную роль. Новые
 * политики адресованы positive_platform, поэтому на positive_app влиять не
 * должны — но «не должны» это предположение, пока его не проверили. Поэтому
 * последний случай ходит ролью приложения и убеждается, что она по-прежнему
 * слепа без объявленного заведения.
 */

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Строка подключения роли платформы. Приём и довод — как в тесте изоляции. */
const platformUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_PLATFORM_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_PLATFORM_ROLE — строка подключения под ролью ' +
      'positive_platform. Без неё границы роли, которая видит ВСЕ заведения, ' +
      'не проверяются вовсе. Пропущенная проверка здесь хуже красной.',
  )
}

const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — строка подключения под positive_app.')
}

const ownerUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST — подключение владельца базы.')
}

/**
 * Схема берётся у самого соединения, а не из переменной окружения.
 *
 * На общей с чужим продуктом базе разойтись в схеме означало бы проверять
 * права на таблицы соседа и успокоиться.
 */
const currentSchema = async (client: Client): Promise<string> => {
  const result = await client.query<{ schema: string }>('SELECT current_schema() AS schema')
  const schema = result.rows[0]?.schema
  if (schema === undefined || schema === null) {
    throw new Error('current_schema() вернул пусто — соединение смотрит в никуда.')
  }
  return schema
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
  return client
}

/** Запрос, от которого ждут отказа по правам. Возвращает текст ошибки. */
const expectDenied = async (client: Client, sql: string): Promise<string> => {
  try {
    await client.query(sql)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error(`Запрос прошёл, хотя должен был получить отказ по правам:\n  ${sql}`)
}

describe('Роль positive_platform: видит всех, но не всё', () => {
  let platform: Client
  let appRole: Client
  let owner: Client
  let tenantsForOwner = 0
  let probeTenantId = ''

  beforeAll(async () => {
    platform = await connect(platformUrl())
    appRole = await connect(appRoleUrl())
    owner = await connect(ownerUrl())

    for (const client of [platform, appRole, owner]) {
      const schema = await currentSchema(client)
      await client.query(`SET search_path TO "${schema}"`)
    }

    // Своё заведение, а не надежда на чужие данные.
    //
    // Полагаться на то, что база уже наполнена, здесь нельзя дважды: порядок
    // файлов в прогоне не гарантирован, и на пустой базе проверки вида
    // «роль видит столько же, сколько владелец» выродились бы в «ноль равен
    // нулю» — зелено и бессмысленно. Поэтому заведение создаём сами и сами же
    // убираем; заодно появляется строка, о которой роль платформы заведомо
    // ничего не объявляла, то есть кросс-тенантное чтение проверяется честно.
    const created = await owner.query<{ id: string }>(
      `INSERT INTO "Tenant" ("id", "brandName", "vertical", "settings")
       VALUES (gen_random_uuid(), $1, 'RESTAURANT', '{}'::jsonb)
       RETURNING "id"`,
      [`PROBE платформа ${process.pid}`],
    )
    probeTenantId = created.rows[0]?.id ?? ''

    const counted = await owner.query<{ n: string }>('SELECT count(*)::int AS n FROM "Tenant"')
    tenantsForOwner = Number(counted.rows[0]?.n ?? 0)
  })

  afterAll(async () => {
    if (probeTenantId !== '') {
      await owner.query('DELETE FROM "Tenant" WHERE "id" = $1', [probeTenantId])
    }

    await platform.end()
    await appRole.end()
    await owner.end()
  })

  /**
   * Страж невырожденности.
   *
   * Все проверки ниже вида «роль видит столько же, сколько владелец» или
   * «роли отказано». На пустой базе первая половина выполняется сама собой:
   * ноль равен нулю. Тогда файл был бы зелёным, ничего не доказав.
   */
  it('в базе есть хотя бы одно заведение, иначе проверять нечего', () => {
    expect(probeTenantId).not.toBe('')
    expect(tenantsForOwner).toBeGreaterThan(0)
  })

  it('видит ВСЕ заведения — ради этого роль и заводилась', async () => {
    const seen = await platform.query<{ n: string }>('SELECT count(*)::int AS n FROM "Tenant"')
    expect(Number(seen.rows[0]?.n)).toBe(tenantsForOwner)
  })

  it('видит конкретное чужое заведение, ничего о нём не объявляя', async () => {
    // Именно то, что запрещено всей остальной системе: достать строку заведения,
    // не выставив app.tenant_id. Для positive_app такой запрос вернул бы пусто.
    const found = await platform.query<{ brandName: string }>(
      'SELECT "brandName" FROM "Tenant" WHERE "id" = $1',
      [probeTenantId],
    )

    expect(found.rows).toHaveLength(1)
    expect(found.rows[0]?.brandName).toContain('PROBE платформа')
  })

  it('читает участия и журнал баллов по всем заведениям', async () => {
    await expect(platform.query('SELECT count(*) FROM "Membership"')).resolves.toBeDefined()
    await expect(platform.query('SELECT count(*) FROM "LedgerEntry"')).resolves.toBeDefined()
  })

  it('читает аудит — у обычного приложения такого права нет намеренно', async () => {
    await expect(platform.query('SELECT count(*) FROM "AuditLog"')).resolves.toBeDefined()
  })

  it('считает гостей и их режимы, не зная, кто они', async () => {
    // Разрешённые колонки Guest: счёт и разбивка турист/резидент возможны...
    await expect(
      platform.query('SELECT "mode", count(*) FROM "Guest" GROUP BY "mode"'),
    ).resolves.toBeDefined()
  })

  it('НЕ ВИДИТ телефон гостя', async () => {
    const message = await expectDenied(platform, 'SELECT "phoneE164" FROM "Guest" LIMIT 1')
    expect(message).toMatch(/permission denied/i)
  })

  it('НЕ ВИДИТ имя гостя и день рождения', async () => {
    expect(await expectDenied(platform, 'SELECT "displayName" FROM "Guest" LIMIT 1')).toMatch(
      /permission denied/i,
    )
    expect(await expectDenied(platform, 'SELECT "birthday" FROM "Guest" LIMIT 1')).toMatch(
      /permission denied/i,
    )
  })

  it('НЕ ВИДИТ хеш PIN-кода сотрудника — это учётные данные', async () => {
    const message = await expectDenied(platform, 'SELECT "pinHash" FROM "Staff" LIMIT 1')
    expect(message).toMatch(/permission denied/i)
  })

  it('НЕ ВИДИТ таблицы с секретами: ключ вебхуков, сессии, коды входа', async () => {
    for (const table of ['PosLink', 'Session', 'GuestSession', 'OtpRequest', 'GuestIdentity']) {
      const message = await expectDenied(platform, `SELECT * FROM "${table}" LIMIT 1`)
      expect(message, `таблица ${table} оказалась доступна роли платформы`).toMatch(
        /permission denied/i,
      )
    }
  })

  it('НЕ МОЖЕТ изменить баланс — панель смотрит, а не правит', async () => {
    const message = await expectDenied(platform, 'UPDATE "Membership" SET "pointsBalance" = 999999')
    expect(message).toMatch(/permission denied/i)
  })

  it('НЕ МОЖЕТ удалять и заводить заведения', async () => {
    expect(await expectDenied(platform, 'DELETE FROM "Tenant"')).toMatch(/permission denied/i)
    expect(await expectDenied(platform, `INSERT INTO "Tenant" ("id") VALUES ('x')`)).toMatch(
      /permission denied/i,
    )
  })

  /**
   * Вторая половина смысла миграции: обычная роль не пострадала.
   *
   * Политики platform_reads_all адресованы positive_platform, поэтому на
   * positive_app влиять не должны. Пока это не проверено — это предположение.
   */
  it('обычная роль приложения по-прежнему слепа без объявленного заведения', async () => {
    const seen = await appRole.query<{ n: string }>('SELECT count(*)::int AS n FROM "Tenant"')

    expect(
      Number(seen.rows[0]?.n),
      'positive_app увидел заведения без объявленного тенанта — политики платформы протекли',
    ).toBe(0)
  })
})
