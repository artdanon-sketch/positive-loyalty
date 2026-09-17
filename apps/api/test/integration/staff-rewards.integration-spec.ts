import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'
import { StaffRewardsService } from '../../src/core/staff-rewards.service'

import {
  createMembershipFixture,
  createTenant,
  idempotencyKey,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Мотивация кассиров. docs/03, раздел 6 · docs/05, раздел 6.1.
 *
 * Полигон: заведение с доплатой «100 ฿ за нового гостя», кассир, гость-новичок,
 * гость с телефоном самого кассира и постоянный гость.
 *
 * Проверяется то, что стоит денег: за кого платим, за кого нет и когда награда
 * становится обязательством заведения.
 */

const SECRET = 'staff-rewards-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let rewards: StaffRewardsService
let tenantId: string
let cashierId: string
let ownerToken: string
let fresh: MembershipFixture
let regular: MembershipFixture
let selfLinked: MembershipFixture

const server = (): Server => app.getHttpServer() as Server

/** Чек от имени кассира — тот же путь, каким его проводит касса. */
const receipt = async (membership: MembershipFixture, basisAmount: number): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId: membership.membershipId,
      amount: Math.floor(basisAmount / 20),
      basisAmount,
      idempotencyKey: idempotencyKey('staff-reward'),
      refType: 'receipt',
      refId: `sr-${randomUUID().slice(0, 8)}`,
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId: cashierId,
    },
    membership.scope,
  )

  return result.entry.id
}

const rewardOf = async (ledgerEntryId: string) =>
  prisma.staffReward.findFirst({
    where: { ledgerEntryId },
    select: { amount: true, state: true, reason: true },
  })

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)
  rewards = moduleRef.get(StaffRewardsService)

  tenantId = await createTenant(prisma)
  fresh = await createMembershipFixture(prisma, { tenantId })
  regular = await createMembershipFixture(prisma, { tenantId })
  selfLinked = await createMembershipFixture(prisma, { tenantId })

  const phone = `+6688${String(Date.now()).slice(-7)}`
  const cashier = await prisma.staff.create({
    data: { tenantId, displayName: 'Кассир Лек', role: 'CASHIER', phoneE164: phone },
    select: { id: true },
  })
  cashierId = cashier.id

  // Гость с тем же номером, что у кассира, — классическая накрутка.
  await prisma.guest.update({ where: { id: selfLinked.guestId }, data: { phoneE164: phone } })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)

  // Доплата: 100 ฿ за нового гостя, зачёт на втором визите.
  await request(server())
    .put('/v1/admin/settings/program/staff-reward')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      enabled: true,
      basis: 'PER_NEW_GUEST',
      value: 10_000,
      vesting: 'ON_SECOND_VISIT',
      shiftCap: 15,
    })
    .expect(200)
})

afterAll(async () => {
  await app.close()
})

describe('Мотивация кассиров: начисление', () => {
  it('НАСТРОЙКА ДОПЛАТЫ СОХРАНИЛАСЬ — ИНАЧЕ ОСТАЛЬНОЕ ПРОВЕРЯТЬ НЕЧЕГО', async () => {
    const response = await request(server())
      .get('/v1/admin/settings/program/staff-reward')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ enabled: true, basis: 'PER_NEW_GUEST', value: 10_000 })
  })

  it('ЗА НОВОГО ГОСТЯ НАГРАДА ЕСТЬ, НО ЖДЁТ ВТОРОГО ВИЗИТА', async () => {
    const entryId = await receipt(fresh, 100_000)

    await rewards.tick()

    expect(await rewardOf(entryId)).toMatchObject({ amount: 10_000, state: 'PENDING' })
  })

  it('ГОСТЬ ПРИШЁЛ ВТОРОЙ РАЗ — НАГРАДА ДОЗРЕЛА; ЗА САМ ВТОРОЙ ЧЕК НЕ ПЛАТИМ', async () => {
    const second = await receipt(fresh, 50_000)

    await rewards.tick()
    // Второй проход: дозревание идёт по уже записанным наградам.
    await rewards.tick()

    const first = await prisma.staffReward.findFirst({
      where: { tenantId, membershipId: fresh.membershipId, state: 'VESTED' },
      select: { amount: true },
    })
    expect(first).toMatchObject({ amount: 10_000 })

    expect(await rewardOf(second)).toMatchObject({
      state: 'CANCELLED',
      reason: 'Гость не новый, а платим только за новых',
    })
  })

  it('ЧЕК НА СВОЙ НОМЕР НЕ ОПЛАЧИВАЕТСЯ — И ПРИЧИНА ВИДНА', async () => {
    const entryId = await receipt(selfLinked, 80_000)

    await rewards.tick()

    expect(await rewardOf(entryId)).toMatchObject({
      amount: 0,
      state: 'CANCELLED',
      reason: 'Чек на гостя с номером самого сотрудника',
    })
  })

  it('ОТМЕНЁННЫЙ ЧЕК СНИМАЕТ НАГРАДУ', async () => {
    const entryId = await receipt(regular, 120_000)

    await rewards.tick()
    expect(await rewardOf(entryId)).toMatchObject({ state: 'PENDING' })

    await ledger.reverse(
      {
        entryId,
        idempotencyKey: idempotencyKey('staff-reward-void'),
        reason: 'RECEIPT_VOIDED',
        source: 'STAFF_MANUAL',
        actorType: 'STAFF',
        actorId: cashierId,
      },
      regular.scope,
    )

    await rewards.tick()

    expect(await rewardOf(entryId)).toMatchObject({ state: 'CANCELLED', reason: 'Чек отменён' })
  })

  it('ОТЧЁТ «СОТРУДНИКИ» ПОКАЗЫВАЕТ ЗАРАБОТАННОЕ И ОТДЕЛЬНО НЕДОЗРЕВШЕЕ', async () => {
    const response = await request(server())
      .get('/v1/admin/reports/staff')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(response.status).toBe(200)
    const body = response.body as {
      staff: Array<{ staffId: string; earned: number; earnedPending: number }>
    }
    const row = body.staff.find((item) => item.staffId === cashierId)

    // Снятые награды в заработок не идут — платят только за то, что состоялось.
    expect(row?.earned).toBe(10_000)
    expect(row?.earnedPending).toBe(0)
  })
})
