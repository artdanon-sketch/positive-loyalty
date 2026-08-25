/**
 * Негативные сценарии ledger: то, что обязано быть отклонено, и то, что после отказа
 * обязано НЕ остаться в журнале.
 *
 * Проверка «операция упала» сама по себе стоит немного. Ценность в паре утверждений:
 * упала И не оставила следов. Реализация, которая пишет строку журнала, а потом
 * бросает исключение, первую половину теста проходит — и оставляет за собой мусор,
 * из-за которого кэш расходится с суммой.
 *
 * Здесь же живут кросс-тенантные проверки (Definition of Done в CLAUDE.md: «кросс-
 * тенантный тест зелёный, если задача трогает данные») и проверка того, что tenantId
 * из тела запроса не принимается — железное правило 2.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  countByIdempotencyKey,
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  expectLedgerError,
  idempotencyKey,
  POS_ORIGIN,
  readBalance,
  readCounters,
  readLedgerSum,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/** Потолок int4: `Membership.pointsBalance` и `LedgerEntry.balanceAfter` — PostgreSQL integer. */
const INT32_MAX = 2_147_483_647

describe('LedgerService — отказы и границы', () => {
  let context: LedgerTestContext
  let fixture: MembershipFixture

  beforeAll(async () => {
    context = await createLedgerTestContext()
  })

  afterAll(async () => {
    // beforeAll мог упасть до создания контекста — тогда закрывать нечего,
    // и настоящую причину падения не должен перекрывать TypeError из teardown.
    await context?.close()
  })

  beforeEach(async () => {
    fixture = await createMembershipFixture(context.prisma)
  })

  const earn = async (amount: number, label: string): Promise<void> => {
    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount,
        idempotencyKey: idempotencyKey(label),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )
  }

  it('списание больше баланса отклоняется и не оставляет следов в журнале', async () => {
    await earn(300, 'guard-earn')

    const key = idempotencyKey('redeem-too-much')

    const error = await expectLedgerError(
      () =>
        context.ledger.redeem(
          {
            membershipId: fixture.membershipId,
            amount: 500,
            idempotencyKey: key,
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'INSUFFICIENT_BALANCE',
    )

    expect(error.details.available).toBe(300)
    expect(error.details.requested).toBe(500)

    // Ни строки журнала, ни изменения кэша: транзакция откатилась целиком.
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await countByIdempotencyKey(context.prisma, key)).toBe(0)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(300)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(300)

    // Ключ остался свободным — доказательство отката на уровне UNIQUE-индекса:
    // если бы строка всё-таки записалась, повтор с этим ключом вернул бы её как replay.
    const retry = await context.ledger.redeem(
      {
        membershipId: fixture.membershipId,
        amount: 200,
        idempotencyKey: key,
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(retry.replayed).toBe(false)
    expect(retry.entry.amount).toBe(-200)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(100)
  })

  it('списание ровно на весь баланс проходит', async () => {
    await earn(250, 'guard-earn-exact')

    const result = await context.ledger.redeem(
      {
        membershipId: fixture.membershipId,
        amount: 250,
        idempotencyKey: idempotencyKey('redeem-exact'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    // Граница «хватает ровно» обязана быть с той стороны, где операция проходит:
    // строгое сравнение вместо нестрогого — классическая ошибка на единицу.
    expect(result.entry.balanceAfter).toBe(0)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('списание с нулевого баланса отклоняется', async () => {
    await expectLedgerError(
      () =>
        context.ledger.redeem(
          {
            membershipId: fixture.membershipId,
            amount: 1,
            idempotencyKey: idempotencyKey('redeem-empty'),
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'INSUFFICIENT_BALANCE',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('начисление нуля разрешено и двигает счётчики визита', async () => {
    // Контрольная группа (Membership.isControlGroup): визит есть, баллов нет.
    // Без этого доказать эффект программы будет нечем.
    const result = await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 0,
        basisAmount: 45_000,
        idempotencyKey: idempotencyKey('earn-zero'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(result.entry.amount).toBe(0)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readCounters(context.prisma, fixture.membershipId)).toStrictEqual({
      visitsTotal: 1,
      spentTotal: 45_000,
    })
  })

  it('переполнение int4 отклоняется до вставки', async () => {
    await earn(INT32_MAX, 'guard-overflow-base')

    await expectLedgerError(
      () =>
        context.ledger.earn(
          {
            membershipId: fixture.membershipId,
            amount: 1,
            idempotencyKey: idempotencyKey('earn-overflow'),
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'BALANCE_OVERFLOW',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(INT32_MAX)
  })

  it('дробная сумма не проходит валидацию', async () => {
    // Деньги и баллы — целые в минорных единицах (CLAUDE.md, правило 4).
    await expectLedgerError(
      () =>
        context.ledger.earn(
          {
            membershipId: fixture.membershipId,
            amount: 10.5,
            idempotencyKey: idempotencyKey('earn-fraction'),
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'LEDGER_INPUT_INVALID',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('tenantId в теле запроса не принимается', async () => {
    const neighbour = await createMembershipFixture(context.prisma)

    // Схемы контрактов объявлены через .strict(): лишнее поле — это ошибка валидации,
    // а не «просто проигнорируем». Иначе касса могла бы передать чужой tenantId телом
    // запроса и получить mass assignment поверх границы тенанта.
    // Переменная, а не литерал в аргументе: TypeScript отвергает лишнее поле в литерале,
    // а проверить нужно поведение рантайма — HTTP-тело приходит без всякого TypeScript.
    const payload = {
      membershipId: fixture.membershipId,
      amount: 100,
      idempotencyKey: idempotencyKey('earn-mass-assignment'),
      tenantId: neighbour.tenantId,
      ...POS_ORIGIN,
    }

    await expectLedgerError(
      () => context.ledger.earn(payload, fixture.scope),
      'LEDGER_INPUT_INVALID',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('начисление на участие соседнего тенанта не находит участия', async () => {
    const neighbour = await createMembershipFixture(context.prisma)
    const key = idempotencyKey('earn-foreign')

    // 404 MEMBERSHIP_NOT_FOUND, а не 403: 403 подтверждает существование участия
    // и является утечкой (docs/02, раздел 0).
    await expectLedgerError(
      () =>
        context.ledger.earn(
          {
            membershipId: neighbour.membershipId,
            amount: 100,
            idempotencyKey: key,
            ...POS_ORIGIN,
          },
          fixture.scope, // токен ПЕРВОГО тенанта
        ),
      'MEMBERSHIP_NOT_FOUND',
    )

    expect(await countEntries(context.prisma, neighbour.membershipId)).toBe(0)
    expect(await countByIdempotencyKey(context.prisma, key)).toBe(0)
    expect(await readBalance(context.prisma, neighbour.membershipId)).toBe(0)
  })

  it('списание с участия соседнего тенанта не находит участия', async () => {
    const neighbour = await createMembershipFixture(context.prisma)

    await context.ledger.earn(
      {
        membershipId: neighbour.membershipId,
        amount: 900,
        idempotencyKey: idempotencyKey('earn-neighbour'),
        ...POS_ORIGIN,
      },
      neighbour.scope,
    )

    await expectLedgerError(
      () =>
        context.ledger.redeem(
          {
            membershipId: neighbour.membershipId,
            amount: 900,
            idempotencyKey: idempotencyKey('redeem-foreign'),
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'MEMBERSHIP_NOT_FOUND',
    )

    // Баллы соседа на месте: чужой токен не списывает.
    expect(await readBalance(context.prisma, neighbour.membershipId)).toBe(900)
    expect(await countEntries(context.prisma, neighbour.membershipId)).toBe(1)
  })
})
