import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaPg } from '@prisma/adapter-pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { PrismaClient } from '../../src/generated/prisma/client'
import type { Prisma } from '../../src/generated/prisma/client'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { TenantGuard } from '../../src/common/tenant/tenant.guard'
import { LedgerService } from '../../src/core/ledger.service'
import { buildSchemaBoundConfig, PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, idempotencyKey, POS_ORIGIN } from './ledger-test-context'

/**
 * Изоляция заведений. Задача 3, docs/06 раздел 8 · docs/05 раздел 3.
 *
 * Требование ТЗ дословно: «под токеном тенанта A перебрать все эндпоинты с
 * идентификаторами объектов тенанта B, ожидание — 404 везде».
 *
 * Тест доказывает КАЖДЫЙ рубеж отдельно, потому что они защищают от разного:
 *   · гвард     — от запроса вообще без токена;
 *   · фильтр+RLS — от чужого идентификатора под валидным токеном;
 *   · RLS сам   — от забытого фильтра в коде.
 * Один общий «всё зелено» скрыл бы отказ любого из трёх.
 */

const SECRET = 'integration-test-secret-not-used-anywhere-else'

interface Fixture {
  readonly tenantId: string
  readonly membershipId: string
  readonly guestId: string
  readonly ledgerEntryId: string
  readonly token: string
}

let app: INestApplication
let prisma: PrismaService

/**
 * `getHttpServer()` объявлен как `any`, и supertest принимает его молча.
 * Под type-aware правилами это 11 ошибок `no-unsafe-argument`, и они по делу:
 * `any` здесь прячет реальные опечатки в маршрутах. Сужаем один раз.
 */
const server = (): Server => app.getHttpServer() as Server
let a: Fixture
let b: Fixture

const buildFixture = async (
  prisma: PrismaService,
  ledger: LedgerService,
  label: string,
): Promise<Fixture> => {
  const base = await createMembershipFixture(prisma)

  // Операция создаётся через LedgerService, а не INSERT'ом: журнал append-only,
  // и обходить его в тестах — значит проверять не то, что работает в проде.
  const entry = await ledger.earn(
    {
      membershipId: base.membershipId,
      amount: 1_000,
      basisAmount: 20_000,
      idempotencyKey: idempotencyKey(`isolation-${label}`),
      ...POS_ORIGIN,
    },
    base.scope,
  )

  return {
    tenantId: base.tenantId,
    membershipId: base.membershipId,
    guestId: base.guestId,
    ledgerEntryId: entry.entry.id,
    token: signAccessToken({ tenantId: base.tenantId, actorId: null, role: 'OWNER' }, SECRET),
  }
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  // Тот же префикс, что и в main.ts: без него пути в тесте разойдутся с боевыми
  // и тест начнёт проверять маршруты, которых в проде нет.
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  const ledger = moduleRef.get(LedgerService)

  a = await buildFixture(prisma, ledger, 'a')
  b = await buildFixture(prisma, ledger, 'b')
}, 60_000)

afterAll(async () => {
  TenantGuard.disabledForTest = false
  await app.close()
})

describe('Изоляция заведений — рубеж 0: гвард', () => {
  it('без токена закрытый эндпоинт отдаёт 401', async () => {
    await request(server()).get('/v1/admin/ledger').expect(401)
  })

  it('с негодным токеном — тоже 401, и причина наружу не уходит', async () => {
    const response = await request(server())
      .get('/v1/admin/ledger')
      // Значение заголовка обязано быть ASCII: кириллица здесь роняет сам клиент
      // ещё до отправки, и тест проверял бы не сервер, а собственную опечатку.
      .set('Authorization', 'Bearer not-a-real-token.at.all')
      .expect(401)

    const body = JSON.stringify(response.body)
    // Ни «подпись не сошлась», ни «просрочен»: разница между ними — подсказка подбирающему.
    expect(body).not.toMatch(/подпись|signature|expired|просроч/i)
  })

  it('health остаётся публичным: healthcheck ходит без токена', async () => {
    await request(server()).get('/health').expect(200)
  })

  /**
   * Требование приёмки: «тест зелёный и падает при намеренном отключении гварда».
   *
   * Проверяем это прямо, а не на словах: выключаем гвард и убеждаемся, что
   * ответ перестал быть 401. Если бы 401 приходил откуда-то ещё, а гвард был
   * декоративным, эта проверка бы не прошла — и весь блок выше ничего не стоил бы.
   */
  it('с выключенным гвардом 401 пропадает — значит его даёт именно гвард', async () => {
    TenantGuard.disabledForTest = true
    try {
      const response = await request(server()).get('/v1/admin/ledger')
      expect(response.status).not.toBe(401)
    } finally {
      TenantGuard.disabledForTest = false
    }

    // И сразу обратно: защита вернулась.
    await request(server()).get('/v1/admin/ledger').expect(401)
  })
})

describe('Изоляция заведений — рубеж 1 и 2: чужие идентификаторы', () => {
  it('свои объекты доступны — иначе 404 ниже ничего не доказывает', async () => {
    await request(server())
      .get(`/v1/admin/ledger/${a.ledgerEntryId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)

    await request(server())
      .get(`/v1/admin/memberships/${a.membershipId}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)
  })

  it('перебор эндпоинтов с идентификаторами чужого заведения даёт 404', async () => {
    const foreignRoutes = [
      `/v1/admin/ledger/${b.ledgerEntryId}`,
      `/v1/admin/memberships/${b.membershipId}`,
    ]

    for (const route of foreignRoutes) {
      const response = await request(server()).get(route).set('Authorization', `Bearer ${a.token}`)

      // Именно 404, а не 403: 403 подтверждает существование объекта
      // и сам по себе является утечкой (docs/02, раздел 0).
      expect(response.status, `маршрут ${route}`).toBe(404)
    }
  })

  it('список операций не содержит ни одной чужой', async () => {
    const response = await request(server())
      .get('/v1/admin/ledger?limit=100')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200)

    const { items } = response.body as { items: Array<{ id: string; membershipId: string }> }

    expect(items.some((item) => item.id === a.ledgerEntryId)).toBe(true)
    expect(items.some((item) => item.id === b.ledgerEntryId)).toBe(false)
    expect(items.every((item) => item.membershipId === a.membershipId)).toBe(true)
  })

  it('подмена tenantId в теле и query ничего не меняет: он берётся только из токена', async () => {
    const response = await request(server())
      .get(`/v1/admin/ledger?limit=100&tenantId=${b.tenantId}`)
      .set('Authorization', `Bearer ${a.token}`)

    // .strict() в AdminListQuery отвергает лишнее поле — попытка не проходит
    // валидацию, а не «проходит, но игнорируется». Разница важна: молчаливое
    // игнорирование выглядит как успех и маскирует попытку подбора.
    expect([400, 200]).toContain(response.status)

    if (response.status === 200) {
      const { items } = response.body as { items: Array<{ id: string }> }
      expect(items.some((item) => item.id === b.ledgerEntryId)).toBe(false)
    }
  })
})

describe('Изоляция заведений — рубеж 2 в одиночку', () => {
  /**
   * ПОЧЕМУ ЗДЕСЬ ОТДЕЛЬНОЕ СОЕДИНЕНИЕ.
   *
   * Владелец таблицы политики RLS ИГНОРИРУЕТ — ровно так же, как игнорирует REVOKE.
   * Тесты и миграции ходят в базу владельцем, поэтому проверять RLS тем же
   * соединением бессмысленно: он покажет зелёное независимо от того, работают
   * политики или нет. Именно так выглядит проверка, которая ничего не проверяет.
   *
   * Поэтому блок открывает своё соединение под ролью positive_app — той самой,
   * под которой обязано работать приложение в бою.
   *
   * Если роль в тестовой базе не заведена, блок ЧЕСТНО падает с инструкцией,
   * а не пропускается молча: пропущенная проверка изоляции хуже красной.
   */
  const appRoleUrl = (): string => {
    const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit
    }
    throw new Error(
      'Не задан DATABASE_URL_TEST_APP_ROLE — строка подключения под ролью positive_app. ' +
        'Без неё RLS не проверяется: тесты ходят владельцем, а владельца политики не касаются. ' +
        'Как завести роль локально — в prisma/README.md.',
    )
  }

  let appRole: PrismaClient

  beforeAll(() => {
    // Подключение собирается ТЕМ ЖЕ кодом, что и рабочее.
    //
    // Раньше здесь стояло `new PrismaPg({ connectionString })` без опции схемы.
    // На схеме public это работало по совпадению с умолчанием, а на своей —
    // молча ушло бы не туда: без опции драйвер зашивает в каждый идентификатор
    // литерал `public`, то есть запросы этого теста читали бы схему соседа.
    //
    // Проверка изоляции, которая сама ходит не в ту схему, — ровно та самая
    // «зелёная проверка, которая ничего не проверяет», о которой сказано выше.
    const { poolConfig, adapterOptions } = buildSchemaBoundConfig(
      appRoleUrl(),
      process.env['DATABASE_SCHEMA']?.trim() || 'public',
    )

    appRole = new PrismaClient({
      adapter: new PrismaPg(poolConfig, adapterOptions),
      errorFormat: 'minimal',
    })
  })

  afterAll(async () => {
    await appRole.$disconnect()
  })

  const underTenant = async <T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> =>
    appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  it('роль приложения БЕЗ объявленного тенанта не видит ничего', async () => {
    const rows = await appRole.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "LedgerEntry"
    `
    expect(Number(rows[0]?.count ?? -1)).toBe(0)
  })

  it('под тенантом A сырой запрос не отдаёт строки заведения B', async () => {
    const rows = await underTenant(
      a.tenantId,
      async (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LedgerEntry" WHERE id = ${b.ledgerEntryId}
      `,
    )

    expect(rows).toHaveLength(0)
  })

  it('свой объект тем же сырым запросом виден — проверка не вырождена', async () => {
    const rows = await underTenant(
      a.tenantId,
      async (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LedgerEntry" WHERE id = ${a.ledgerEntryId}
      `,
    )

    expect(rows).toHaveLength(1)
  })

  it('запись в журнал чужого заведения отвергается базой', async () => {
    await expect(
      underTenant(
        a.tenantId,
        async (tx) =>
          tx.$executeRaw`
          INSERT INTO "LedgerEntry"
            (id, "tenantId", "guestId", "membershipId", type, amount, "balanceAfter",
             source, "idempotencyKey", "actorType")
          VALUES (gen_random_uuid()::text, ${b.tenantId}, ${b.guestId}, ${b.membershipId},
                  'EARN', 100, 100, 'STAFF_MANUAL', ${idempotencyKey('rls-cross')}, 'SYSTEM')
        `,
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('forTenant без тенанта не выполняется: пустое значение выключило бы политики', async () => {
    await expect(prisma.forTenant('   ', () => Promise.resolve('не должно дойти'))).rejects.toThrow(
      /tenantId/i,
    )
  })
})
