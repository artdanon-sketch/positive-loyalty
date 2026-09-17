import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { LedgerService } from '../../src/core/ledger.service'
import { PointsExpiryService } from '../../src/core/points-expiry.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  idempotencyKey,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Сгорание баллов. docs/02, раздел 5.6.8.
 *
 * Полигон: заведение со сроком жизни баллов 30 дней и соседнее без срока.
 * У гостя есть старое начисление и свежее — сгореть должно только старое.
 *
 * Это единственное место, где система списывает баллы без участия человека,
 * поэтому проверяется и то, что она НЕ списывает.
 */

const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let expiry: PointsExpiryService
let guest: MembershipFixture
let neighbour: MembershipFixture

const balanceOf = async (membershipId: string): Promise<number> => {
  const row = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { pointsBalance: true },
  })

  return row?.pointsBalance ?? 0
}

/** Начисление задним числом: occurredAt задаёт возраст баллов. */
const earnAt = async (fixture: MembershipFixture, amount: number, at: Date): Promise<void> => {
  await ledger.earn(
    {
      membershipId: fixture.membershipId,
      amount,
      basisAmount: amount * 20,
      idempotencyKey: idempotencyKey('expiry'),
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId: undefined,
      occurredAt: at.toISOString(),
    },
    fixture.scope,
  )
}

beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)
  expiry = moduleRef.get(PointsExpiryService)

  guest = await createMembershipFixture(prisma)
  neighbour = await createMembershipFixture(prisma)

  await prisma.tenant.update({
    where: { id: guest.tenantId },
    data: { settings: { pointsExpireDays: 30 } },
  })

  // Соседнее заведение срока не ставит: его гостя трогать нельзя.
  await prisma.tenant.update({
    where: { id: neighbour.tenantId },
    data: { settings: {} },
  })

  const longAgo = new Date(Date.now() - 60 * DAY_MS)
  const recently = new Date(Date.now() - 2 * DAY_MS)

  await earnAt(guest, 500, longAgo)
  await earnAt(guest, 200, recently)
  await earnAt(neighbour, 400, longAgo)
})

afterAll(async () => {
  await app.close()
})

describe('Сгорание баллов', () => {
  it('СГОРАЕТ ТОЛЬКО СТАРОЕ, СВЕЖЕЕ ОСТАЁТСЯ', async () => {
    expect(await balanceOf(guest.membershipId)).toBe(700)

    const result = await expiry.tick()

    expect(result.burned).toBeGreaterThan(0)
    expect(await balanceOf(guest.membershipId)).toBe(200)
  })

  it('В ИСТОРИИ ЭТО ОТДЕЛЬНАЯ СТРОКА «СГОРЕЛИ», А НЕ ПРАВКА ВРУЧНУЮ', async () => {
    const entry = await prisma.ledgerEntry.findFirst({
      where: { membershipId: guest.membershipId, type: 'EXPIRE' },
      select: { amount: true, actorType: true },
    })

    expect(entry).toMatchObject({ amount: -500, actorType: 'SYSTEM' })
  })

  it('ВТОРОЙ ПРОХОД В ТОТ ЖЕ ДЕНЬ НИЧЕГО НЕ ЖЖЁТ ПОВТОРНО', async () => {
    await expiry.tick()

    expect(await balanceOf(guest.membershipId)).toBe(200)
  })

  it('ЗАВЕДЕНИЕ БЕЗ СРОКА ЖИЗНИ БАЛЛОВ НЕ ТРОНУТО', async () => {
    expect(await balanceOf(neighbour.membershipId)).toBe(400)
  })

  it('ПОТРАЧЕННОЕ НЕ СГОРАЕТ ВТОРОЙ РАЗ', async () => {
    const other = await createMembershipFixture(prisma)
    await prisma.tenant.update({
      where: { id: other.tenantId },
      data: { settings: { pointsExpireDays: 30 } },
    })

    await earnAt(other, 500, new Date(Date.now() - 60 * DAY_MS))
    await ledger.redeem(
      {
        membershipId: other.membershipId,
        amount: 300,
        idempotencyKey: idempotencyKey('expiry-redeem'),
        source: 'STAFF_MANUAL',
        actorType: 'STAFF',
        actorId: undefined,
      },
      other.scope,
    )

    await expiry.tick()

    // Сгореть должно ровно то, что осталось от старых: 500 − 300.
    expect(await balanceOf(other.membershipId)).toBe(0)

    const burned = await prisma.ledgerEntry.findFirst({
      where: { membershipId: other.membershipId, type: 'EXPIRE' },
      select: { amount: true },
    })
    expect(burned?.amount).toBe(-200)
  })
})
