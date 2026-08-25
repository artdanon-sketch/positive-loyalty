/**
 * ТЕСТ 2 из четырёх обязательных для Задачи 2 — ГОНКА ДВУХ НАЧИСЛЕНИЙ.
 *
 * Дословно из docs/06, раздел 2: «Тест на гонку баланса — напиши его первым, до
 * реализации. Если он не проходит — вся остальная работа бессмысленна».
 *
 * Что именно он ловит. Без `Serializable` две транзакции читают один и тот же
 * `pointsBalance`, каждая прибавляет к нему своё и записывает результат: второе
 * начисление затирает первое, баланс становится 200 вместо 300 (docs/01, раздел 4.4).
 * При этом обе строки журнала на месте — расхождение кэша с журналом обнаружится
 * только ночной сверкой, а гость к тому времени уже увидит не свои баллы.
 *
 * ПОЧЕМУ ЦИКЛ, А НЕ ОДИН ПРОГОН. Гонка — это про везение планировщика: реализация
 * без Serializable проходит одиночный запуск в заметной доле случаев, потому что
 * транзакции успевают разъехаться во времени. Повторы превращают «повезло» в «не бывает».
 * Каждая итерация — отдельный тест: в упавшем прогоне сразу видно, какая именно.
 *
 * Тест НЕ РЕТРАИТСЯ: `retry: 0` в vitest.integration.config.mts. Ретрай мигающего
 * теста на гонку — это способ покрасить сломанную блокировку в зелёный.
 */
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isLedgerError } from '../../src/core/ledger.errors'
import {
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  idempotencyKey,
  isFulfilled,
  isRejected,
  POS_ORIGIN,
  readBalance,
  readLedgerSum,
  settle,
  type LedgerTestContext,
} from './ledger-test-context'

/** Сколько раз прогонять гонку. Меньше пяти — самообман, больше двадцати — долго. */
const ITERATIONS = 10

/** Плотность конкуренции во втором тесте: пять одновременных начислений на одно участие. */
const CROWD_AMOUNTS = [10, 20, 30, 40, 50] as const

describe('LedgerService — гонка параллельных начислений', () => {
  let context: LedgerTestContext

  beforeAll(async () => {
    context = await createLedgerTestContext()
  })

  afterAll(async () => {
    // beforeAll мог упасть до создания контекста — тогда закрывать нечего,
    // и настоящую причину падения не должен перекрывать TypeError из teardown.
    await context?.close()
  })

  it.each(Array.from({ length: ITERATIONS }, (_, index) => index + 1))(
    'два параллельных начисления не теряют одно из них (итерация %i)',
    async () => {
      // Своё участие на каждую итерацию: гонка не должна складываться с предыдущей.
      const { membershipId, scope } = await createMembershipFixture(context.prisma)

      const key1 = randomUUID()
      const key2 = randomUUID()

      // Promise.all — обязательно. Два await подряд гонку не создают вовсе.
      await Promise.all([
        context.ledger.earn(
          { membershipId, amount: 100, idempotencyKey: key1, ...POS_ORIGIN },
          scope,
        ),
        context.ledger.earn(
          { membershipId, amount: 200, idempotencyKey: key2, ...POS_ORIGIN },
          scope,
        ),
      ])

      // Читаем базу напрямую, а не результаты вызовов: проверяем состояние, а не ответы.
      const membership = await context.prisma.membership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { pointsBalance: true },
      })
      const sum = await context.prisma.ledgerEntry.aggregate({
        where: { membershipId },
        _sum: { amount: true },
      })

      expect(membership.pointsBalance).toBe(300)
      expect(sum._sum.amount).toBe(300)

      // Обе операции записаны: 300 из одной строки — это тоже потерянное обновление.
      expect(await countEntries(context.prisma, membershipId)).toBe(2)
    },
  )

  it('при плотной конкуренции кэш остаётся равен журналу', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)

    // Пять одновременных начислений на одно участие. Под Serializable часть из них
    // может не уложиться в отведённые ретраи — и это ШТАТНЫЙ исход: сервис обязан
    // отдать конфликт вызывающему, а не тихо потерять начисление. Поэтому проверяем
    // не фиксированную сумму, а инвариант: баланс равен сумме тех операций,
    // которые действительно записаны.
    const attempts = await Promise.all(
      CROWD_AMOUNTS.map((amount) =>
        settle(
          context.ledger.earn(
            {
              membershipId,
              amount,
              idempotencyKey: idempotencyKey(`crowd-${String(amount)}`),
              ...POS_ORIGIN,
            },
            scope,
          ),
        ),
      ),
    )

    const written = attempts.filter(isFulfilled)
    const expectedTotal = written.reduce((total, attempt) => total + attempt.value.entry.amount, 0)

    expect(await readBalance(context.prisma, membershipId)).toBe(expectedTotal)
    expect(await readLedgerSum(context.prisma, membershipId)).toBe(expectedTotal)
    expect(await countEntries(context.prisma, membershipId)).toBe(written.length)

    // Единственный допустимый отказ — исчерпанный ретрай сериализации. Любая другая
    // ошибка здесь означала бы, что конкуренция ломает не то, что должна.
    const failureCodes = attempts
      .filter(isRejected)
      .map((attempt) => (isLedgerError(attempt.error) ? attempt.error.code : 'НЕ_ДОМЕННАЯ_ОШИБКА'))

    expect(failureCodes).toStrictEqual(failureCodes.map(() => 'LEDGER_WRITE_CONFLICT'))
  })

  it('параллельные начисления на разные участия не мешают друг другу', async () => {
    // Обратная проверка к предыдущей: блокировка должна быть по участию, а не по таблице.
    // Реализация, запирающая журнал целиком, тест на гонку тоже пройдёт — и превратит
    // кассу в очередь из одного человека.
    const first = await createMembershipFixture(context.prisma)
    const second = await createMembershipFixture(context.prisma, { tenantId: first.tenantId })

    await Promise.all([
      context.ledger.earn(
        {
          membershipId: first.membershipId,
          amount: 100,
          idempotencyKey: idempotencyKey('parallel-first'),
          ...POS_ORIGIN,
        },
        first.scope,
      ),
      context.ledger.earn(
        {
          membershipId: second.membershipId,
          amount: 700,
          idempotencyKey: idempotencyKey('parallel-second'),
          ...POS_ORIGIN,
        },
        second.scope,
      ),
    ])

    expect(await readBalance(context.prisma, first.membershipId)).toBe(100)
    expect(await readBalance(context.prisma, second.membershipId)).toBe(700)
    expect(await readLedgerSum(context.prisma, first.membershipId)).toBe(100)
    expect(await readLedgerSum(context.prisma, second.membershipId)).toBe(700)
  })
})
