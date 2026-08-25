/**
 * ТЕСТ 1 из четырёх обязательных для Задачи 2 — ИДЕМПОТЕНТНОСТЬ.
 *
 * docs/02, раздел 0: «Повтор с тем же ключом возвращает тот же ответ с тем же кодом,
 * а не создаёт новую операцию. Повтор с тем же ключом, но другим телом — 409
 * IDEMPOTENCY_KEY_REUSED». docs/05, раздел 5, правило 2 — то же самое со стороны денег.
 *
 * Проверяется и последовательный повтор (касса отправила запрос дважды из-за таймаута),
 * и ОДНОВРЕМЕННЫЙ: два запроса с одним ключом, вышедшие в один момент. Второй случай
 * важнее первого — именно он ловит реализацию, где идемпотентность сделана проверкой
 * «поискали и не нашли»: два параллельных запроса проходят такую проверку одновременно
 * и начисляют дважды. Последовательный повтор при этом остаётся зелёным и создаёт
 * ложное чувство защищённости.
 */
import type { EarnInput, RedeemInput } from '@positive/contracts'
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

describe('LedgerService — идемпотентность', () => {
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

  // Своё участие на каждый тест: чистое состояние без удаления чужих строк.
  beforeEach(async () => {
    fixture = await createMembershipFixture(context.prisma)
  })

  it('повторный earn с тем же ключом не создаёт вторую операцию', async () => {
    const key = idempotencyKey('earn-replay')
    const input: EarnInput = {
      membershipId: fixture.membershipId,
      amount: 500,
      basisAmount: 69_000, // 690,00 ฿ в сатангах: минорные единицы, никаких float
      idempotencyKey: key,
      refType: 'receipt',
      refId: 'R-000001',
      ...POS_ORIGIN,
    }

    const first = await context.ledger.earn(input, fixture.scope)
    const second = await context.ledger.earn(input, fixture.scope)

    // Повтор обязан вернуть ПЕРВЫЙ результат целиком, а не просто «тоже успех».
    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.entry).toStrictEqual(first.entry)

    expect(await countByIdempotencyKey(context.prisma, key)).toBe(1)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)

    // Баланс сдвинулся ровно один раз — и кэш, и журнал.
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(500)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(500)

    // Побочные эффекты начисления повтор тоже не выполняет повторно.
    expect(await readCounters(context.prisma, fixture.membershipId)).toStrictEqual({
      visitsTotal: 1,
      spentTotal: 69_000,
    })
  })

  it('два ОДНОВРЕМЕННЫХ earn с одним ключом дают одну запись', async () => {
    const key = idempotencyKey('earn-parallel')
    const input: EarnInput = {
      membershipId: fixture.membershipId,
      amount: 250,
      basisAmount: 30_000,
      idempotencyKey: key,
      ...POS_ORIGIN,
    }

    // Promise.all, а не два await подряд: последовательный вызов проверяет другое.
    const [left, right] = await Promise.all([
      context.ledger.earn(input, fixture.scope),
      context.ledger.earn(input, fixture.scope),
    ])

    expect(left.entry.id).toBe(right.entry.id)

    // Ровно один из двух — повтор. Оба повтора невозможны (кто-то же вставил строку),
    // оба не-повтора означали бы двойное начисление.
    expect([left.replayed, right.replayed].filter(Boolean)).toHaveLength(1)

    expect(await countByIdempotencyKey(context.prisma, key)).toBe(1)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(250)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(250)
    expect((await readCounters(context.prisma, fixture.membershipId)).visitsTotal).toBe(1)
  })

  it('повторный redeem с тем же ключом списывает один раз', async () => {
    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 1_000,
        idempotencyKey: idempotencyKey('earn-before-redeem'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    const key = idempotencyKey('redeem-replay')
    const input: RedeemInput = {
      membershipId: fixture.membershipId,
      amount: 400,
      idempotencyKey: key,
      ...POS_ORIGIN,
    }

    const first = await context.ledger.redeem(input, fixture.scope)
    const second = await context.ledger.redeem(input, fixture.scope)

    expect(second.entry.id).toBe(first.entry.id)
    expect(second.replayed).toBe(true)
    // Знак ставит сервис: на входе модуль, в журнале — минус.
    expect(first.entry.amount).toBe(-400)

    expect(await countByIdempotencyKey(context.prisma, key)).toBe(1)
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(2)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(600)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(600)
  })

  it('тот же ключ с другой суммой отклоняется как переиспользованный', async () => {
    const key = idempotencyKey('earn-reused')

    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 100,
        idempotencyKey: key,
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    await expectLedgerError(
      () =>
        context.ledger.earn(
          {
            membershipId: fixture.membershipId,
            amount: 900, // другое тело при том же ключе
            idempotencyKey: key,
            ...POS_ORIGIN,
          },
          fixture.scope,
        ),
      'IDEMPOTENCY_KEY_REUSED',
    )

    // Отказ не должен ничего дописать и ничего не должен вернуть из первой операции.
    expect(await countEntries(context.prisma, fixture.membershipId)).toBe(1)
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(100)
    expect(await readLedgerSum(context.prisma, fixture.membershipId)).toBe(100)
  })

  it('ключ, занятый другим тенантом, не отдаёт его операцию', async () => {
    const key = idempotencyKey('earn-cross-tenant')

    await context.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 700,
        idempotencyKey: key,
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    // Соседний мерчант: свой тенант, свой гость, своё участие.
    const neighbour = await createMembershipFixture(context.prisma)

    const error = await expectLedgerError(
      () =>
        context.ledger.earn(
          {
            membershipId: neighbour.membershipId,
            amount: 700,
            idempotencyKey: key,
            ...POS_ORIGIN,
          },
          neighbour.scope,
        ),
      'IDEMPOTENCY_KEY_REUSED',
    )

    // В details уходит то, что прислал вызывающий, и ничего из чужой записи:
    // иначе ответ рассказывал бы про операцию соседнего мерчанта.
    expect(error.details.expectedMembershipId).toBe(neighbour.membershipId)

    expect(await countEntries(context.prisma, neighbour.membershipId)).toBe(0)
    expect(await readBalance(context.prisma, neighbour.membershipId)).toBe(0)
    // Операция первого тенанта не пострадала.
    expect(await readBalance(context.prisma, fixture.membershipId)).toBe(700)
  })
})
