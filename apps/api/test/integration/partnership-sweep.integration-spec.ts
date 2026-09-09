import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OfferGrantService } from '../../src/core/offer-grant.service'
import { PrismaService } from '../../src/core/prisma.service'
import { PartnershipSweepService } from '../../src/partnerships/partnership-sweep.service'
import { PartnershipTriggerService } from '../../src/partnerships/partnership-trigger.service'

/**
 * Разгребатель партнёрских триггеров: от записи в журнале до промокода,
 * без единого зова из кассового пути.
 *
 * ─── Что здесь сторожится, и почему только базой ─────────────────────────────
 *
 * Слушателя проверяет соседний тест. Здесь проверяется ВЫБОРКА — функция
 * `ledger_entries_awaiting_partnership`, живущая в SQL и не поддающаяся
 * юнит-тесту вовсе:
 *
 *   отметка о разборе    второй проход не должен выдать награду ещё раз;
 *   чужие заведения      операция заведения без активных условий не разбирается,
 *                        иначе разгребатель ходил бы по всему журналу платформы;
 *   только начисления    подарок за то, что гость ПОТРАТИЛ баллы, — не то,
 *                        о чём договариваются заведения;
 *   счёт визитов         вычисляется по самому журналу, поля такого нет.
 *                        Ошибка здесь тихая: условие «третий визит» просто
 *                        не сработает никогда, и никто не заметит.
 *
 * Под ролью positive_app: разгребатель ходит поверх границ заведений через
 * SECURITY DEFINER, а отметку ставит уже под конкретным заведением. Под
 * владельцем базы политики не работают, и эта разница исчезла бы.
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
let sweep: PartnershipSweepService
let owner: Client

interface Scene {
  studio: string
  resto: string
  guest: string
  membership: string
  offerId: string
  termId: string
}

/** Студия, ресторан, гость с участием и активное условие между ними. */
const seed = async (trigger?: unknown): Promise<Scene> => {
  const studio = randomUUID()
  const resto = randomUUID()
  const guest = randomUUID()
  const membership = randomUUID()
  const offerId = randomUUID()
  const partnershipId = randomUUID()
  const termId = randomUUID()

  for (const id of [studio, resto]) {
    await owner.query(
      `INSERT INTO "Tenant" ("id","brandName","vertical","settings")
       VALUES ($1, $2, 'RESTAURANT', '{}'::jsonb)`,
      [id, `Заведение ${id.slice(0, 6)}`],
    )
  }

  await owner.query(`INSERT INTO "Guest" ("id") VALUES ($1)`, [guest])
  await owner.query(`INSERT INTO "Membership" ("id","guestId","tenantId") VALUES ($1,$2,$3)`, [
    membership,
    guest,
    studio,
  ])

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
      JSON.stringify(trigger ?? { type: 'ON_PURCHASE', minAmount: 100_000 }),
      JSON.stringify({ kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 }),
      JSON.stringify({ totalGrants: null, perGuest: 5, dailyCap: null }),
    ],
  )

  return { studio, resto, guest, membership, offerId, termId }
}

/** Запись журнала. Пишем владельцем: журнал наполняет ledger, а не этот тест. */
const entry = async (
  scene: Scene,
  over: { type?: string; refType?: string | null; basisAmount?: number | null } = {},
): Promise<string> => {
  const id = randomUUID()

  await owner.query(
    `INSERT INTO "LedgerEntry"
       ("id","tenantId","guestId","membershipId","type","amount","balanceAfter",
        "basisAmount","source","refType","idempotencyKey","actorType")
     VALUES ($1,$2,$3,$4,$5::"LedgerType",10,10,$6,'SIGNED_QR',$7,$8,'SYSTEM')`,
    [
      id,
      scene.studio,
      scene.guest,
      scene.membership,
      over.type ?? 'EARN',
      over.basisAmount === undefined ? 500_000 : over.basisAmount,
      over.refType === undefined ? 'receipt' : over.refType,
      randomUUID(),
    ],
  )

  return id
}

const grantCount = async (offerId: string): Promise<number> => {
  const rows = await owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "OfferGrant" WHERE "offerId" = $1`,
    [offerId],
  )

  return Number(rows.rows[0]?.n)
}

describe('Разгребатель партнёрских триггеров', () => {
  beforeAll(async () => {
    const previous = process.env['DATABASE_URL']
    process.env['DATABASE_URL'] = appRoleUrl()

    try {
      prisma = new PrismaService()
      await prisma.onModuleInit()
      sweep = new PartnershipSweepService(
        prisma,
        new PartnershipTriggerService(prisma, new OfferGrantService(prisma)),
      )
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

  it('НАХОДИТ ОПЕРАЦИЮ В ЖУРНАЛЕ И ВЫДАЁТ ПО НЕЙ НАГРАДУ', async () => {
    const scene = await seed()
    const entryId = await entry(scene)

    const result = await sweep.tick()

    expect(result.scanned).toBeGreaterThanOrEqual(1)
    expect(await grantCount(scene.offerId)).toBe(1)

    const run = await owner.query<{ grantsIssued: number }>(
      `SELECT "grantsIssued" FROM "PartnershipTriggerRun" WHERE "ledgerEntryId" = $1`,
      [entryId],
    )
    expect(run.rowCount, 'отметка о разборе обязана появиться').toBe(1)
    expect(run.rows[0]?.grantsIssued).toBe(1)
  })

  it('ВТОРОЙ ПРОХОД ТУ ЖЕ ОПЕРАЦИЮ НЕ БЕРЁТ', async () => {
    const scene = await seed()
    await entry(scene)

    await sweep.tick()
    await sweep.tick()

    // Без отметки разгребатель разбирал бы одну и ту же операцию вечно.
    // Ключ идемпотентности спас бы от второго промокода, но проход по журналу
    // рос бы без конца, а награду считали бы заново каждые десять секунд.
    expect(await grantCount(scene.offerId)).toBe(1)

    const runs = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "PartnershipTriggerRun" WHERE "tenantId" = $1`,
      [scene.studio],
    )
    expect(Number(runs.rows[0]?.n)).toBe(1)
  })

  it('ОПЕРАЦИЮ ЗАВЕДЕНИЯ БЕЗ УСЛОВИЙ НЕ ТРОГАЕТ ВОВСЕ', async () => {
    const scene = await seed()

    // То же заведение, но условие выключено: разгребатель обязан пройти мимо,
    // а не разобрать и выдать ноль наград. Иначе он ходил бы по всему журналу
    // платформы ради заведений, у которых партнёрств нет.
    await owner.query(`UPDATE "PartnershipTerm" SET "status" = 'PAUSED' WHERE "id" = $1`, [
      scene.termId,
    ])

    const entryId = await entry(scene)

    await sweep.tick()

    const run = await owner.query(
      `SELECT 1 FROM "PartnershipTriggerRun" WHERE "ledgerEntryId" = $1`,
      [entryId],
    )
    expect(run.rowCount, 'операция не должна была попасть в выборку').toBe(0)
  })

  it('СПИСАНИЕ НАГРАДЫ НЕ ПОРОЖДАЕТ', async () => {
    const scene = await seed()
    const entryId = await entry(scene, { type: 'REDEEM' })

    await sweep.tick()

    const run = await owner.query(
      `SELECT 1 FROM "PartnershipTriggerRun" WHERE "ledgerEntryId" = $1`,
      [entryId],
    )
    expect(run.rowCount, 'подарок за трату баллов — не партнёрство').toBe(0)
    expect(await grantCount(scene.offerId)).toBe(0)
  })

  it('ОТМЕТКУ НЕЛЬЗЯ ПЕРЕПИСАТЬ: UPDATE приложению не выдан', async () => {
    const scene = await seed()
    const entryId = await entry(scene)

    await sweep.tick()

    // ALTER DEFAULT PRIVILEGES (миграция 20260828100000) выдаёт приложению
    // SELECT, INSERT и UPDATE на КАЖДУЮ новую таблицу автоматически. Лишнее
    // отобрано явным REVOKE — и это единственное, что стоит между «отметка
    // о разборе» и «строка, которую можно переписать задним числом».
    //
    // Проверка нужна именно здесь: забыть REVOKE в следующей миграции легко,
    // а последствие — молчаливое, потому что права ошибок не выдают.
    await expect(
      prisma.forTenant(scene.studio, async (tx) =>
        tx.partnershipTriggerRun.updateMany({
          where: { ledgerEntryId: entryId },
          data: { grantsIssued: 999 },
        }),
      ),
    ).rejects.toThrow()
  })

  it('СЧИТАЕТ ВИЗИТЫ ПО ЖУРНАЛУ: третий визит — третья запись', async () => {
    const scene = await seed({ type: 'ON_NTH_VISIT', n: 3 })

    // Поля «каким по счёту визит» в журнале нет; выборка считает его сама.
    // Если счёт собьётся, условие «третий визит» не сработает НИКОГДА,
    // и заметить это по логам будет нельзя.
    await entry(scene)
    await sweep.tick()
    expect(await grantCount(scene.offerId), 'первый визит — рано').toBe(0)

    await entry(scene)
    await sweep.tick()
    expect(await grantCount(scene.offerId), 'второй визит — всё ещё рано').toBe(0)

    await entry(scene)
    await sweep.tick()
    expect(await grantCount(scene.offerId), 'третий визит — пора').toBe(1)

    await entry(scene)
    await sweep.tick()
    expect(await grantCount(scene.offerId), 'четвёртый визит — уже поздно').toBe(1)
  })
})
