/**
 * ТЕСТ 3 из четырёх обязательных для Задачи 2 — КОМПЕНСАЦИЯ ВОЗВРАТА.
 *
 * docs/01, раздел 4.4, правило 3 и docs/05, раздел 5, правило 4: отмена операции
 * создаёт запись `REVERSAL` со ссылкой `reversalOfId`, а НЕ правит исходную.
 *
 * Ключевая проверка здесь — не «баланс вернулся», а «исходная запись не изменилась
 * ни одним полем». Реализация, которая правит `amount` исходной строки, вернёт баланс
 * так же аккуратно, и тест на баланс её пропустит. Отличает их только сравнение строки
 * журнала до и после: журнал, который можно переписать, перестаёт быть доказательством.
 *
 * Второй слой той же защиты — на стороне базы (триггер append-only), он проверяется
 * в ledger-append-only.integration-spec.ts.
 */
import type { EarnInput, ReverseInput } from '@positive/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  assertLedgerError,
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  expectLedgerError,
  idempotencyKey,
  isFulfilled,
  isRejected,
  POS_ORIGIN,
  readBalance,
  readCounters,
  readLedgerSum,
  settle,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

describe('LedgerService — компенсация возврата', () => {
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

  /** Начисление, которое потом отменяем. Возвращает id записи журнала. */
  const earnOnce = async (amount: number, basisAmount: number): Promise<string> => {
    const input: EarnInput = {
      membershipId: fixture.membershipId,
      amount,
      basisAmount,
      idempotencyKey: idempotencyKey('earn-to-reverse'),
      refType: 'receipt',
      refId: 'R-000077',
      ...POS_ORIGIN,
    }

    const result = await context.ledger.earn(input, fixture.scope)
    return result.entry.id
  }

  const reversalInput = (entryId: string, label = 'reverse'): ReverseInput => ({
    entryId,
    idempotencyKey: idempotencyKey(label),
    reason: 'RECEIPT_VOIDED',
    ...POS_ORIGIN,
  })

  it('отмена не трогает исходную запись и возвращает баланс', async () => {
    const entryId = await earnOnce(800, 100_000)

    // Снимок исходной строки ЦЕЛИКОМ, включая служебные поля.
    const before = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })

    const reversal = await context.ledger.reverse(reversalInput(entryId), fixture.scope)

    const after = await context.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })

    // Главное утверждение теста: исходная запись не изменилась ни в одном поле.
    expect(after).toStrictEqual(before)

    // Появилась встречная запись — с противоположным знаком и ссылкой на исходную.
    expect(reversal.replayed).toBe(false)
    expect(reversal.entry.type).toBe('REVERSAL')
    expect(reversal.entry.amount).toBe(-before.amount)
    expect(reversal.entry.reversalOfId).toBe(entryId)
    expect(reversal.entry.balanceAfter).toBe(0)
    expect(reversal.entry.id).not.toBe(entryId)

    // Ссылка на чек и валюта унаследованы: компенсация обязана находиться по тому же refId.
    expect(reversal.entry.refType).toBe(before.refType)
    expect(reversal.entry.refId).toBe(before.refId)
    expect(reversal.entry.currency).toBe(before.currency)

    // Баланс вернулся к исходному, и кэш сходится с журналом.
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(0)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)

    // Счётчики визита, которые двигало начисление, откатились вместе с ним.
    expect(await readCounters(context.prisma, fixture.membershipId)).toStrictEqual({
      visitsTotal: 0,
      spentTotal: 0,
    })
  })

  it('повторная отмена той же записи отклоняется', async () => {
    const entryId = await earnOnce(300, 50_000)
    await context.ledger.reverse(reversalInput(entryId, 'reverse-first'), fixture.scope)

    // Другой ключ идемпотентности: это не повтор запроса, а вторая попытка отменить.
    await expectLedgerError(
      () => context.ledger.reverse(reversalInput(entryId, 'reverse-second'), fixture.scope),
      'ALREADY_REVERSED',
    )

    // Вторая компенсация не появилась — иначе отмена стала бы способом начислять баллы.
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('повтор отмены с тем же ключом возвращает первую компенсацию', async () => {
    const entryId = await earnOnce(300, 50_000)
    const input = reversalInput(entryId, 'reverse-idempotent')

    const first = await context.ledger.reverse(input, fixture.scope)
    const second = await context.ledger.reverse(input, fixture.scope)

    expect(second.replayed).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('две ОДНОВРЕМЕННЫЕ отмены создают одну компенсацию', async () => {
    const entryId = await earnOnce(450, 60_000)

    // Разные ключи — значит идемпотентность тут ни при чём: гонку обязан поймать
    // UNIQUE по reversalOfId, а не проверка «уже отменено».
    const attempts = await Promise.all([
      settle(context.ledger.reverse(reversalInput(entryId, 'reverse-race-a'), fixture.scope)),
      settle(context.ledger.reverse(reversalInput(entryId, 'reverse-race-b'), fixture.scope)),
    ])

    expect(attempts.filter(isFulfilled)).toHaveLength(1)

    const failures = attempts.filter(isRejected)
    expect(failures).toHaveLength(1)

    const [failure] = failures
    assertLedgerError(failure?.error, 'ALREADY_REVERSED')

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('компенсацию отменить нельзя', async () => {
    const entryId = await earnOnce(200, 20_000)
    const reversal = await context.ledger.reverse(reversalInput(entryId), fixture.scope)

    // Цепочка REVERSAL → REVERSAL — это способ начислять баллы без чека:
    // каждая следующая компенсация меняет знак предыдущей.
    await expectLedgerError(
      () =>
        context.ledger.reverse(
          reversalInput(reversal.entry.id, 'reverse-of-reversal'),
          fixture.scope,
        ),
      'CANNOT_REVERSE_REVERSAL',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('отмена списания возвращает баллы и не трогает счётчики визитов', async () => {
    await earnOnce(1_000, 120_000)

    const redeem = await context.ledger.redeem(
      {
        membershipId: fixture.membershipId,
        amount: 300,
        idempotencyKey: idempotencyKey('redeem-to-reverse'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(700)

    const reversal = await context.ledger.reverse(
      reversalInput(redeem.entry.id, 'reverse-redeem'),
      fixture.scope,
    )

    expect(reversal.entry.amount).toBe(300)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(1_000)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(1_000)

    // Визит засчитало начисление; отмена списания к визиту отношения не имеет.
    expect(await readCounters(context.prisma, fixture.membershipId)).toStrictEqual({
      visitsTotal: 1,
      spentTotal: 120_000,
    })
  })

  it('отмена начисления, баллы по которому уже потрачены, не уводит баланс в минус', async () => {
    const entryId = await earnOnce(500, 70_000)

    await context.ledger.redeem(
      {
        membershipId: fixture.membershipId,
        amount: 500,
        idempotencyKey: idempotencyKey('redeem-all'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    // docs/05, схема 6.6: политика «уводить в минус или обнулять» принадлежит
    // ProgramConfig и приедет с движком правил. До тех пор ledger просто отказывает.
    await expectLedgerError(
      () => context.ledger.reverse(reversalInput(entryId, 'reverse-spent'), fixture.scope),
      'INSUFFICIENT_BALANCE',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(0)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(0)
  })

  it('запись соседнего тенанта не находится и не отменяется', async () => {
    const entryId = await earnOnce(600, 80_000)
    const neighbour = await createMembershipFixture(context.prisma)

    // 404, а не 403: 403 подтверждает существование записи и является утечкой
    // (docs/02, раздел 0).
    await expectLedgerError(
      () => context.ledger.reverse(reversalInput(entryId, 'reverse-foreign'), neighbour.scope),
      'LEDGER_ENTRY_NOT_FOUND',
    )

    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(600)
  })
})
