import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LedgerFutureEventError } from '../../src/core/ledger.errors'

import {
  createLedgerTestContext,
  createMembershipFixture,
  idempotencyKey,
  POS_ORIGIN,
  type LedgerTestContext,
} from './ledger-test-context'

/**
 * Время СОБЫТИЯ отдельно от времени записи.
 *
 * Зачем поле существует: чек приходит от кассы вебхуком, и вебхук опаздывает —
 * связь на острове рвётся, касса работает офлайн и досылает смену вечером.
 * Без `occurredAt` вечерняя выгрузка легла бы одним столбцом отчёта, а «загрузка
 * по часам» показала бы девять вечера вместо обеда.
 *
 * Проверяется здесь ровно то, что легко сломать незаметно: что `createdAt`
 * остаётся временем записи, что даты визитов ходят по времени события, и что
 * будущее не принимается ни под каким видом.
 */

let context: LedgerTestContext

const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(async () => {
  context = await createLedgerTestContext()
}, 60_000)

afterAll(async () => {
  await context.close()
})

describe('Время события в журнале', () => {
  it('записывается отдельно от времени записи', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)
    const occurredAt = new Date(Date.now() - 3 * DAY_MS)

    const result = await context.ledger.earn(
      {
        membershipId,
        amount: 500,
        basisAmount: 10_000,
        idempotencyKey: idempotencyKey('occurred-basic'),
        occurredAt: occurredAt.toISOString(),
        ...POS_ORIGIN,
      },
      scope,
    )

    expect(result.entry.occurredAt).toBe(occurredAt.toISOString())
    // `createdAt` отвечает на другой вопрос — когда МЫ УЗНАЛИ, — и остаётся сейчас.
    expect(new Date(result.entry.createdAt).getTime()).toBeGreaterThan(occurredAt.getTime())
  })

  it('без указания времени события поле пустое, а не продублировано', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)

    const result = await context.ledger.earn(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('occurred-absent'),
        ...POS_ORIGIN,
      },
      scope,
    )

    // null означает «событие и запись совпадают». Копия createdAt здесь была бы
    // хуже: по ней нельзя отличить настоящее опоздание от его отсутствия.
    expect(result.entry.occurredAt).toBeNull()
  })

  it('даты визитов идут по времени события, а не записи', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)
    const longAgo = new Date(Date.now() - 40 * DAY_MS)

    await context.ledger.earn(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('occurred-first'),
        occurredAt: longAgo.toISOString(),
        ...POS_ORIGIN,
      },
      scope,
    )

    const membership = await context.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { firstVisitAt: true, lastVisitAt: true },
    })

    // Опоздавший вебхук не делает вчерашний обед сегодняшним визитом: иначе
    // сегмент «спящие» опустел бы при каждой догрузке старой смены.
    expect(membership.firstVisitAt?.getTime()).toBe(longAgo.getTime())
    expect(membership.lastVisitAt?.getTime()).toBe(longAgo.getTime())
  })

  it('догрузка старой смены не откатывает дату последнего визита назад', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)
    const recent = new Date(Date.now() - 2 * DAY_MS)
    const older = new Date(Date.now() - 30 * DAY_MS)

    await context.ledger.earn(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('occurred-recent'),
        occurredAt: recent.toISOString(),
        ...POS_ORIGIN,
      },
      scope,
    )

    // Касса досылает смену месячной давности УЖЕ ПОСЛЕ свежего визита.
    await context.ledger.earn(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('occurred-older'),
        occurredAt: older.toISOString(),
        ...POS_ORIGIN,
      },
      scope,
    )

    const membership = await context.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { firstVisitAt: true, lastVisitAt: true },
    })

    // Первый визит уехал назад — гость и правда был раньше.
    expect(membership.firstVisitAt?.getTime()).toBe(older.getTime())
    // А последний остался свежим: гость не стал «давно не заходившим» от того,
    // что касса догрузила старый чек.
    expect(membership.lastVisitAt?.getTime()).toBe(recent.getTime())
  })

  it('операция, датированная будущим, отвергается', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)

    // Либо у кассы сбиты часы, либо кто-то заносит покупку в акцию, которая ещё
    // не началась. Оба случая лечатся отказом, а не молчаливым сдвигом даты.
    await expect(
      context.ledger.earn(
        {
          membershipId,
          amount: 100,
          idempotencyKey: idempotencyKey('occurred-future'),
          occurredAt: new Date(Date.now() + DAY_MS).toISOString(),
          ...POS_ORIGIN,
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(LedgerFutureEventError)

    // И ничего не записано: отказ обязан быть полным.
    const count = await context.prisma.ledgerEntry.count({ where: { membershipId } })
    expect(count).toBe(0)
  })

  it('расхождение часов кассы на секунды не роняет чек', async () => {
    const { membershipId, scope } = await createMembershipFixture(context.prisma)

    // Часы кассы и сервера расходятся на секунды всегда. Отказывать из-за
    // этого — значит терять настоящие чеки, поэтому допуск оставлен намеренно.
    const result = await context.ledger.earn(
      {
        membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('occurred-skew'),
        occurredAt: new Date(Date.now() + 5_000).toISOString(),
        ...POS_ORIGIN,
      },
      scope,
    )

    expect(result.entry.occurredAt).not.toBeNull()
  })
})
