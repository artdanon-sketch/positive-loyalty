/**
 * Общая оснастка интеграционных тестов ledger.
 *
 * ─── Как устроена изоляция ───────────────────────────────────────────────────
 *
 * Обычный приём «усечь таблицы между тестами» здесь не работает и работать не может:
 * `TRUNCATE`, `DELETE` и `UPDATE` на `LedgerEntry` запрещены триггером
 * `ledger_entry_append_only` (миграция `init_ledger_core`). Отключить триггер ради
 * teardown — значит на время тестов снять ровно ту защиту, которую эти же тесты
 * проверяют; после такого зелёный прогон ничего не доказывает.
 *
 * Поэтому изоляция достигается иначе: КАЖДЫЙ тест заводит собственные
 * `Tenant` + `Guest` + `Membership` со свежими идентификаторами. Чистое состояние
 * получается не удалением чужих строк, а тем, что чужих строк для этого участия
 * не существует вовсе. Побочные плюсы: тесты не мешают друг другу при любом порядке
 * запуска, а журнал прогона остаётся целым — по нему можно разобрать упавший тест.
 *
 * Отдельная схема Postgres на прогон (второй разумный вариант) отвергнута: она
 * требует накатывать миграции на лету перед каждым запуском и держать `search_path`
 * в driver adapter, то есть тестировать конфигурацию, которой нет в проде. Цена выше
 * пользы — база всё равно одноразовая, а вычистить её целиком умеет `pnpm db:reset`.
 *
 * Накопленные за прогоны строки не мешают: все выборки фильтруются по `membershipId`
 * своей фикстуры. Когда тестовая база разрастётся — `pnpm db:reset` на неё.
 *
 * ─── Чего здесь принципиально нет ────────────────────────────────────────────
 *
 * Ни одной прямой записи в `Membership.pointsBalance`. Даже в фикстурах: участие
 * заводится с нулевым балансом, а любое ненулевое состояние набирается вызовами
 * `LedgerService` (CLAUDE.md, железное правило 1). Проставить баланс руками означало бы
 * создать расхождение кэша с журналом прямо в подготовке теста — и тест на сверку
 * начал бы проверять качество этой подготовки, а не поведение сервиса.
 */
import { randomInt, randomUUID } from 'node:crypto'

import { Test, type TestingModule } from '@nestjs/testing'
import type { ActorType, LedgerSource } from '@positive/contracts'
import { expect } from 'vitest'

import { isLedgerError, type LedgerError, type LedgerErrorCode } from '../../src/core/ledger.errors'
import { LedgerEventsService } from '../../src/core/ledger-events.service'
import { LedgerService, type TenantScope } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'
import { TEST_DATABASE_HOWTO } from './setup-integration-env'

/** Поднятые провайдеры плюс способ их закрыть. */
export interface LedgerTestContext {
  readonly prisma: PrismaService
  readonly ledger: LedgerService
  readonly close: () => Promise<void>
}

/** Что должно найтись в базе, прежде чем тесты вообще имеет смысл запускать. */
interface SchemaProbeRow {
  readonly hasLedgerEntry: boolean
  readonly hasMembership: boolean
  readonly hasTenant: boolean
}

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/**
 * Проверяет, что миграции накачены, и падает с инструкцией, если нет.
 *
 * Без этой проверки первый же тест падал бы на `relation "LedgerEntry" does not exist`
 * или на «connect ECONNREFUSED» — сообщениях, по которым непонятно, что чинить.
 * Один SELECT на файл стоит дёшево, а разбор чужого красного прогона — дорого.
 */
const assertSchemaReady = async (prisma: PrismaService): Promise<void> => {
  let rows: SchemaProbeRow[]

  try {
    // Идентификаторы не квалифицированы схемой намеренно: так проверка одинаково
    // верна и для public, и для отдельной схемы в строке подключения.
    rows = await prisma.$queryRaw<SchemaProbeRow[]>`
      SELECT
        to_regclass('"LedgerEntry"') IS NOT NULL AS "hasLedgerEntry",
        to_regclass('"Membership"')  IS NOT NULL AS "hasMembership",
        to_regclass('"Tenant"')      IS NOT NULL AS "hasTenant"
    `
  } catch (error: unknown) {
    // Строку подключения в текст не подставляем: в ней пароль (docs/05, раздел 10).
    throw new Error(
      'Тестовая база недоступна по DATABASE_URL_TEST. Проверьте, что PostgreSQL поднят ' +
        'и строка подключения верна.\n' +
        `Ошибка драйвера — ${describeError(error)}`,
      { cause: error },
    )
  }

  const probe = rows[0]

  if (probe === undefined || !probe.hasLedgerEntry || !probe.hasMembership || !probe.hasTenant) {
    throw new Error(
      `В тестовой базе нет таблиц ledger-контура: миграции не накачены.\n\n${TEST_DATABASE_HOWTO}`,
    )
  }
}

/**
 * Поднимает PrismaService и LedgerService через тестовый модуль Nest.
 *
 * Именно через DI, а не через `new LedgerService(new PrismaService())`: так тесты
 * заодно проверяют, что провайдеры собираются так же, как в приложении, и что
 * трансформ swc отдаёт метаданные декораторов.
 *
 * `init()` вызывается явно — `compile()` жизненный цикл не запускает, а нам нужен
 * `onModuleInit` (создание пула) и парный `onModuleDestroy` в `close()`.
 */
export const createLedgerTestContext = async (): Promise<LedgerTestContext> => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    // `LedgerEventsService` здесь не декорация: журнал публикует в него
    // событие живой ленты после каждой новой операции. Без него не собирается
    // сам `LedgerService` — и это правильно, зависимость настоящая.
    providers: [PrismaService, LedgerService, LedgerEventsService],
  }).compile()

  await moduleRef.init()

  const prisma = moduleRef.get(PrismaService)
  const ledger = moduleRef.get(LedgerService)

  await assertSchemaReady(prisma)

  return {
    prisma,
    ledger,
    close: async () => {
      await moduleRef.close()
    },
  }
}

/** Собственный набор данных одного теста. */
export interface MembershipFixture {
  readonly tenantId: string
  readonly guestId: string
  readonly membershipId: string
  /** То, что в проде придёт из JWT через TenantContext (CLAUDE.md, правило 2). */
  readonly scope: TenantScope
}

/**
 * Синтетический телефон в формате E.164.
 *
 * Реальных номеров в тестах нет и быть не должно: `Guest.phoneE164` — персональные
 * данные (docs/05, раздел 8). Диапазон случайный, коллизия с уже созданным гостем
 * маловероятна, а если случится — упрётся в UNIQUE и тест покраснеет, а не соврёт.
 */
const syntheticPhone = (): string => `+66${String(randomInt(100_000_000, 999_999_999))}`

/** Заводит тенанта. `settings` — пустой ProgramConfig: правила придут со своей задачей. */
export const createTenant = async (prisma: PrismaService): Promise<string> => {
  const tenant = await prisma.tenant.create({
    data: {
      brandName: `Тестовый мерчант ${randomUUID().slice(0, 8)}`,
      vertical: 'RESTAURANT',
      settings: {},
    },
    select: { id: true },
  })

  return tenant.id
}

/**
 * Заводит гостя и его участие в программе. Баланс — ноль: набирать его руками нельзя.
 *
 * @param options.tenantId переиспользовать существующего тенанта (нужно кросс-тенантным
 *   тестам: два участия у одного мерчанта и одно — у соседнего).
 */
export const createMembershipFixture = async (
  prisma: PrismaService,
  options: { readonly tenantId?: string } = {},
): Promise<MembershipFixture> => {
  const tenantId = options.tenantId ?? (await createTenant(prisma))

  const guest = await prisma.guest.create({
    data: { phoneE164: syntheticPhone(), locale: 'ru' },
    select: { id: true },
  })

  const membership = await prisma.membership.create({
    data: { guestId: guest.id, tenantId },
    select: { id: true },
  })

  return {
    tenantId,
    guestId: guest.id,
    membershipId: membership.id,
    scope: { tenantId },
  }
}

/** Происхождение операции: вебхук кассы от имени системы. Одинаково для всех тестов. */
export const POS_ORIGIN: { readonly source: LedgerSource; readonly actorType: ActorType } = {
  source: 'POS_WEBHOOK',
  actorType: 'SYSTEM',
}

/** Уникальный ключ идемпотентности с читаемым префиксом — в упавшем тесте видно, чей он. */
export const idempotencyKey = (label: string): string => `${label}-${randomUUID()}`

/** Кэш баланса — то самое поле, которое обязано совпадать с журналом. */
export const readBalance = async (prisma: PrismaService, membershipId: string): Promise<number> => {
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { pointsBalance: true },
  })

  return membership.pointsBalance
}

/** Счётчики визитов и оборота: их двигает earn и откатывает reverse. */
export const readCounters = async (
  prisma: PrismaService,
  membershipId: string,
): Promise<{ visitsTotal: number; spentTotal: number }> => {
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { visitsTotal: true, spentTotal: true },
  })

  // Пересобираем объект, а не отдаём результат Prisma как есть: `toStrictEqual`
  // сравнивает ещё и прототип, и тест не должен зависеть от того, каким объектом
  // клиент вернул строку.
  return { visitsTotal: membership.visitsTotal, spentTotal: membership.spentTotal }
}

/** Источник истины: SUM(amount) по журналу этого участия. */
export const readLedgerSum = async (
  prisma: PrismaService,
  membershipId: string,
): Promise<number> => {
  const totals = await prisma.ledgerEntry.aggregate({
    where: { membershipId },
    _sum: { amount: true },
  })

  return totals._sum.amount ?? 0
}

/** Сколько записей в журнале у участия. Ноль лишних — часть каждой негативной проверки. */
export const countEntries = async (prisma: PrismaService, membershipId: string): Promise<number> =>
  prisma.ledgerEntry.count({ where: { membershipId } })

/** Сколько записей с таким ключом идемпотентности. Всегда 0 или 1, третьего не дано. */
export const countByIdempotencyKey = async (prisma: PrismaService, key: string): Promise<number> =>
  prisma.ledgerEntry.count({ where: { idempotencyKey: key } })

/**
 * Исход одной операции в параллельной пачке.
 *
 * Своя обёртка, а не `Promise.allSettled`: у `PromiseRejectedResult.reason` тип `any`,
 * и любое обращение к нему протаскивает `any` в тест — прямо против правила из CLAUDE.md.
 * Здесь ошибка приходит как `unknown` и разбирается явно.
 */
export type SettledAttempt<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

export const settle = async <T>(operation: Promise<T>): Promise<SettledAttempt<T>> => {
  try {
    return { ok: true, value: await operation }
  } catch (error: unknown) {
    return { ok: false, error }
  }
}

/** Сузить пачку исходов до успешных. */
export const isFulfilled = <T>(
  attempt: SettledAttempt<T>,
): attempt is { readonly ok: true; readonly value: T } => attempt.ok

/** Сузить пачку исходов до отказов. */
export const isRejected = <T>(
  attempt: SettledAttempt<T>,
): attempt is { readonly ok: false; readonly error: unknown } => !attempt.ok

/**
 * Ждёт доменную ошибку ledger с конкретным кодом и возвращает её для дальнейших проверок.
 *
 * Проверять `rejects.toThrow(/текст/)` здесь нельзя: тексты сообщений локализованы и
 * меняются, а `code` — стабильный контракт (docs/02, раздел 0). Заодно отсекается
 * случай «упало, но не тем»: сетевая ошибка вместо бизнес-правила — это не успех теста.
 */
export const expectLedgerError = async (
  action: () => Promise<unknown>,
  code: LedgerErrorCode,
): Promise<LedgerError> => {
  let caught: unknown
  let succeeded = false

  try {
    await action()
    succeeded = true
  } catch (error: unknown) {
    caught = error
  }

  if (succeeded) {
    throw new Error(`Ожидалась ошибка ${code}, но операция завершилась успешно`)
  }

  return assertLedgerError(caught, code)
}

/**
 * То же самое для уже пойманной ошибки — например, из пачки параллельных операций,
 * где отказ приходит значением, а не исключением.
 */
export const assertLedgerError = (error: unknown, code: LedgerErrorCode): LedgerError => {
  if (!isLedgerError(error)) {
    throw new Error(`Ожидалась доменная ошибка ledger ${code}, получено — ${describeError(error)}`)
  }

  expect(error.code).toBe(code)

  return error
}
