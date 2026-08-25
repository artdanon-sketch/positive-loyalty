/**
 * Запрет UPDATE и DELETE на журнале — со стороны БАЗЫ, а не приложения.
 *
 * docs/05, раздел 5, правило 1: «Не в коде приложения, а в базе. Код можно обойти
 * по ошибке, базу — нет». Миграция `init_ledger_core` прибивает запрет двумя
 * независимыми механизмами (REVOKE + триггеры `ENABLE ALWAYS`), потому что каждый
 * по отдельности обходится.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Без него защита мертва в самом неприятном смысле: она есть, но
 * никто не заметит, если её случайно снесут. `prisma migrate dev` на схеме, где
 * триггеры не описаны, спокойно предложит их удалить; ревьюер увидит «-- DropTrigger»
 * в конце длинного диффа и пропустит. Здесь эта потеря становится красным тестом.
 *
 * ПРО БЕЗОПАСНОСТЬ САМИХ ТЕСТОВ. Ниже есть проверки, которые выполняют `DELETE`
 * без `WHERE` и `TRUNCATE`. Если защита на месте, они падают и ничего не меняют.
 * Если защиты нет — они снесли бы журнал тестовой базы. Поэтому в `beforeAll`
 * стоит интерлок: наличие триггеров проверяется ДО того, как разрушительные
 * команды вообще будут отправлены, и при его срабатывании ни один тест этого файла
 * не запускается.
 *
 * Тексты сообщений об ошибках здесь НЕ проверяются: формулировка исключения и обёртка
 * драйвера — не контракт, они меняются с версией Prisma. Контракт — это «команда
 * отклонена, строка на месте» плюс наличие самих объектов защиты в каталоге Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  idempotencyKey,
  POS_ORIGIN,
  readBalance,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/** Триггеры-стражи из миграции init_ledger_core. */
const REQUIRED_TRIGGERS = ['ledger_entry_no_update_delete', 'ledger_entry_no_truncate'] as const

/** UNIQUE-индексы, на которых держится защита от двойных операций. */
const REQUIRED_UNIQUE_INDEXES = [
  'LedgerEntry_idempotencyKey_key',
  'LedgerEntry_reversalOfId_key',
] as const

interface TriggerRow {
  readonly name: string
  /**
   * `pg_trigger.tgenabled = 'A'` — это ENABLE ALWAYS. Значение по умолчанию 'O' (origin)
   * означало бы, что триггер молча выключается при `session_replication_role = 'replica'`,
   * а этот режим ставят инструменты репликации и массовой загрузки — и вместе с ним
   * получают право переписать журнал.
   *
   * Сравнение сделано в SQL, а не в TypeScript: тип `"char"` разные драйверы отдают
   * по-разному, а boolean возвращается boolean-ом всегда.
   */
  readonly alwaysEnabled: boolean
}

interface IndexRow {
  readonly name: string
}

describe('LedgerEntry — append-only на уровне PostgreSQL', () => {
  let context: LedgerTestContext
  let fixture: MembershipFixture
  let entryId: string

  beforeAll(async () => {
    context = await createLedgerTestContext()

    // ── Интерлок. Пока не убедились, что стражи на месте, ничего не ломаем. ──
    const triggers = await context.prisma.$queryRaw<TriggerRow[]>`
      SELECT tgname AS "name", (tgenabled = 'A') AS "alwaysEnabled"
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('"LedgerEntry"')
        AND NOT tgisinternal
    `

    const installed = new Map(triggers.map((trigger) => [trigger.name, trigger.alwaysEnabled]))
    const missing = REQUIRED_TRIGGERS.filter((name) => !installed.has(name))

    if (missing.length > 0) {
      throw new Error(
        `На LedgerEntry нет триггеров append-only: ${missing.join(', ')}. ` +
          'Либо тестовая база отстала от миграций, либо защиту снесли миграцией — ' +
          'разрушительные проверки этого файла не запускаются, пока это не выяснено.',
      )
    }

    for (const name of REQUIRED_TRIGGERS) {
      expect(installed.get(name)).toBe(true)
    }

    // Данные, на которых будут пробоваться запрещённые команды.
    fixture = await createMembershipFixture(context.prisma)

    const earned = await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 640,
        basisAmount: 80_000,
        idempotencyKey: idempotencyKey('append-only'),
        refType: 'receipt',
        refId: 'R-000640',
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    entryId = earned.entry.id
  })

  afterAll(async () => {
    // beforeAll мог упасть до создания контекста — тогда закрывать нечего,
    // и настоящую причину падения не должен перекрывать TypeError из teardown.
    await context?.close()
  })

  it('UNIQUE-индексы журнала на месте', async () => {
    // Идемпотентность и «нельзя отменить дважды» держатся на этих двух индексах.
    // В приложении есть и свои проверки, но они проигрывают гонку — база не проигрывает.
    const indexes = await context.prisma.$queryRaw<IndexRow[]>`
      SELECT c.relname AS "name"
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('"LedgerEntry"')
        AND i.indisunique
    `

    const names = indexes.map((index) => index.name)

    for (const required of REQUIRED_UNIQUE_INDEXES) {
      expect(names).toContain(required)
    }
  })

  it('UPDATE строки журнала отклоняется базой', async () => {
    const before = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })

    await expect(
      context.prisma
        .$executeRaw`UPDATE "LedgerEntry" SET "amount" = 999999 WHERE "id" = ${entryId}`,
    ).rejects.toThrow()

    const after = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(after).toStrictEqual(before)
  })

  it('массовый UPDATE без WHERE отклоняется базой', async () => {
    const before = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })

    // Ровно тот случай, ради которого защита и написана: «поправлю быстренько всем сразу».
    await expect(
      context.prisma.$executeRaw`UPDATE "LedgerEntry" SET "balanceAfter" = 0`,
    ).rejects.toThrow()

    const after = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(after).toStrictEqual(before)
  })

  it('DELETE строки журнала отклоняется базой', async () => {
    await expect(
      context.prisma.$executeRaw`DELETE FROM "LedgerEntry" WHERE "id" = ${entryId}`,
    ).rejects.toThrow()

    expect(await context.prisma.ledgerEntry.count({ where: { id: entryId } })).toBe(1)
  })

  it('DELETE без WHERE отклоняется базой', async () => {
    // Классический teardown из чужого проекта. Здесь он не работает — и это не
    // недосмотр, а то же самое правило (prisma/README.md, «Что это значит для тестов»).
    await expect(context.prisma.$executeRaw`DELETE FROM "LedgerEntry"`).rejects.toThrow()

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
  })

  it('TRUNCATE журнала отклоняется базой', async () => {
    // TRUNCATE — не UPDATE и не DELETE: построчные триггеры на нём не срабатывают
    // вообще. Его закрывает отдельный пооператорный триггер, и проверять его нужно
    // отдельно, иначе дыра размером во всю таблицу останется незамеченной.
    await expect(context.prisma.$executeRaw`TRUNCATE TABLE "LedgerEntry"`).rejects.toThrow()

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(640)
  })

  it('INSERT остаётся разрешённым', async () => {
    // Контрольная проверка: журнал append-only, а не read-only. Если бы предыдущие
    // тесты проходили из-за общего отсутствия прав, этот бы тоже упал.
    const second = await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 60,
        idempotencyKey: idempotencyKey('append-only-insert'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(second.entry.balanceAfter).toBe(700)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(700)
  })
})
