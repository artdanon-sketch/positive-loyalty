/**
 * ТЕСТ 4 из четырёх обязательных для Задачи 2 — СВЕРКА КЭША С СУММОЙ.
 *
 * docs/01, раздел 4.4, правило 2: `Membership.pointsBalance` — денормализованный кэш,
 * источник истины — `SUM(LedgerEntry.amount)`. docs/05, раздел 5, правило 5: ночной джоб
 * сравнивает одно с другим, расхождение — алерт critical.
 *
 * Здесь проверяются обе стороны утверждения:
 *   • после серии разнотипных операций (earn, redeem, reverse) кэш равен сумме;
 *   • сверка действительно УМЕЕТ ловить расхождение. Без второй проверки первая
 *     ничего не стоит: функция, всегда возвращающая `consistent: true`, пройдёт её.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { assertBalanceConsistent, reconcileTenantBalances } from '../../src/core/balance'
import {
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  expectLedgerError,
  idempotencyKey,
  POS_ORIGIN,
  readBalance,
  readLedgerSum,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

describe('LedgerService — сверка кэша баланса с журналом', () => {
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

  it('после серии earn, redeem и reverse кэш равен сумме журнала', async () => {
    const { membershipId, scope } = fixture

    // Ожидаемый баланс считаем здесь же, шаг за шагом: сверять balanceAfter с суммой,
    // прочитанной из той же базы, — значит проверять базу саму собой. А порядок строк
    // по createdAt восстановить нельзя: TIMESTAMP(3) допускает совпадение до миллисекунды.
    const first = await context.ledger.earn(
      {
        membershipId,
        amount: 1_000,
        basisAmount: 120_000,
        idempotencyKey: idempotencyKey('reconcile-earn-1'),
        refType: 'receipt',
        refId: 'R-100',
        ...POS_ORIGIN,
      },
      scope,
    )
    expect(first.entry.balanceAfter).toBe(1_000)

    const second = await context.ledger.earn(
      {
        membershipId,
        amount: 250,
        basisAmount: 30_000,
        idempotencyKey: idempotencyKey('reconcile-earn-2'),
        ...POS_ORIGIN,
      },
      scope,
    )
    expect(second.entry.balanceAfter).toBe(1_250)

    const redeemed = await context.ledger.redeem(
      {
        membershipId,
        amount: 400,
        idempotencyKey: idempotencyKey('reconcile-redeem-1'),
        ...POS_ORIGIN,
      },
      scope,
    )
    expect(redeemed.entry.amount).toBe(-400)
    expect(redeemed.entry.balanceAfter).toBe(850)

    // Отмена второго начисления: чек оказался проведён по ошибке.
    const reversed = await context.ledger.reverse(
      {
        entryId: second.entry.id,
        idempotencyKey: idempotencyKey('reconcile-reverse'),
        reason: 'WRONG_AMOUNT',
        ...POS_ORIGIN,
      },
      scope,
    )
    expect(reversed.entry.amount).toBe(-250)
    expect(reversed.entry.balanceAfter).toBe(600)

    const last = await context.ledger.redeem(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('reconcile-redeem-2'),
        ...POS_ORIGIN,
      },
      scope,
    )
    expect(last.entry.balanceAfter).toBe(500)

    // 1000 + 250 − 400 − 250 − 100 = 500
    const balance = await readBalance(context.prisma, membershipId)
    const ledgerSum = await readLedgerSum(context.prisma, membershipId)

    expect(balance).toBe(500)
    expect(ledgerSum).toBe(balance)
    expect(await countEntries(context.prisma, membershipId)).toBe(5)

    // Кэш равен и снапшоту последней операции — третье представление того же числа.
    expect(last.entry.balanceAfter).toBe(balance)

    const report = await context.ledger.reconcile(membershipId, scope)

    expect(report.consistent).toBe(true)
    expect(report.drift).toBe(0)
    expect(report.cachedBalance).toBe(500)
    expect(report.ledgerSum).toBe(500)
    expect(report.entryCount).toBe(5)

    // Строгая проверка целостности, которую зовёт вызывающий перед выдачей награды.
    expect(() => {
      assertBalanceConsistent(report)
    }).not.toThrow()
  })

  it('участие без операций сходится на нуле', async () => {
    const report = await context.ledger.reconcile(fixture.membershipId, fixture.scope)

    // Пустой журнал даёт NULL в SUM — если его не превратить в 0, сверка «найдёт»
    // расхождение на каждом новом госте.
    expect(report).toMatchObject({
      consistent: true,
      cachedBalance: 0,
      ledgerSum: 0,
      entryCount: 0,
      drift: 0,
    })
  })

  it('сверка ловит расхождение, если баланс изменили мимо ledger', async () => {
    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 500,
        idempotencyKey: idempotencyKey('drift-earn'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    // ─────────────────────────────────────────────────────────────────────────
    // ВНИМАНИЕ. Следующая строка — единственное место в репозитории, где
    // pointsBalance пишется не из LedgerService, и она нарушает железное правило 1
    // НАМЕРЕННО. Это имитация инцидента: кто-то поправил баланс руками в psql или
    // через будущий эндпоинт, забывший про журнал.
    //
    // Без такой имитации тест выше проверяет только то, что сверка не мешает жить:
    // реализация `consistent: () => true` прошла бы его, и ночной джоб молчал бы
    // ровно в том случае, ради которого он написан.
    //
    // Копировать этот приём в код приложения нельзя ни при каких обстоятельствах.
    // ─────────────────────────────────────────────────────────────────────────
    await context.prisma.membership.update({
      where: { id: fixture.membershipId },
      data: { pointsBalance: 999 },
    })

    const report = await context.ledger.reconcile(fixture.membershipId, fixture.scope)

    expect(report.consistent).toBe(false)
    expect(report.cachedBalance).toBe(999)
    expect(report.ledgerSum).toBe(500)
    expect(report.drift).toBe(499)

    // Журнал при этом не пострадал: источник истины остался прежним.
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(500)

    // Строгая проверка обязана бросить: docs/05, раздел 5 — это алерт critical,
    // а не «небольшая рассинхронизация».
    expect(() => {
      assertBalanceConsistent(report)
    }).toThrow()
  })

  it('пакетная сверка тенанта проверяет все участия за проход', async () => {
    // Три участия одного мерчанта — то, что ночной джоб читает пачкой.
    const second = await createMembershipFixture(context.prisma, { tenantId: fixture.tenantId })
    const third = await createMembershipFixture(context.prisma, { tenantId: fixture.tenantId })

    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 120,
        idempotencyKey: idempotencyKey('batch-1'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )
    await context.ledger.earn(
      {
        membershipId: second.membershipId,
        amount: 340,
        idempotencyKey: idempotencyKey('batch-2'),
        ...POS_ORIGIN,
      },
      second.scope,
    )
    // Третье участие остаётся без операций — джоб обязан пройти и по таким.

    const reports = await reconcileTenantBalances(context.prisma, { tenantId: fixture.tenantId })

    expect(reports).toHaveLength(3)
    expect(reports.every((report) => report.consistent)).toBe(true)

    const byId = new Map(reports.map((report) => [report.membershipId, report]))

    expect(byId.get(fixture.membershipId)?.ledgerSum).toBe(120)
    expect(byId.get(second.membershipId)?.ledgerSum).toBe(340)
    expect(byId.get(third.membershipId)).toMatchObject({ ledgerSum: 0, entryCount: 0 })
  })

  it('участие соседнего тенанта не сверяется', async () => {
    const neighbour = await createMembershipFixture(context.prisma)

    // Сверка тоже ходит через границу тенанта: чужое участие не «пустое», а отсутствующее.
    await expectLedgerError(
      () => context.ledger.reconcile(neighbour.membershipId, fixture.scope),
      'MEMBERSHIP_NOT_FOUND',
    )

    const reports = await reconcileTenantBalances(context.prisma, { tenantId: fixture.tenantId })
    expect(reports.map((report) => report.membershipId)).not.toContain(neighbour.membershipId)
  })
})
