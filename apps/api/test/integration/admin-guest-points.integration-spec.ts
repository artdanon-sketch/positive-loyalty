import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Баллы вручную и заметка в карточке гостя. docs/02, разделы 5.2.3–5.2.4 · docs/11, У5.
 *
 * Каждый тест — свой гость: баланс общий на участие, и соседние тесты иначе
 * видели бы чужие правки.
 */

const SECRET = 'admin-guest-points-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

const server = (): Server => app.getHttpServer() as Server

const tokens = (tenantId: string) => ({
  owner: signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET),
  manager: signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET),
  cashier: signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET),
})

const adjust = (
  fixture: MembershipFixture,
  token: string,
  body: object,
  key: string | null = randomUUID(),
) => {
  const call = request(server())
    .post(`/v1/admin/guests/${fixture.guestId}/points`)
    .set('Authorization', `Bearer ${token}`)

  return (key === null ? call : call.set('Idempotency-Key', key)).send(body)
}

const balanceOf = async (fixture: MembershipFixture) =>
  prisma.membership.findUniqueOrThrow({
    where: { id: fixture.membershipId },
    select: { pointsBalance: true, visitsTotal: true, spentTotal: true },
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
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Баллы вручную', () => {
  it('ВЛАДЕЛЕЦ НАЧИСЛЯЕТ ВРУЧНУЮ — ЖУРНАЛОМ, С ПРИЧИНОЙ В АУДИТЕ; ПОВТОР С ТЕМ ЖЕ КЛЮЧОМ НЕ УДВАИВАЕТ', async () => {
    const fixture = await createMembershipFixture(prisma)
    const { owner } = tokens(fixture.tenantId)
    const key = randomUUID()
    const body = { amount: 5_000, reason: 'Компенсация за долгое ожидание' }

    const first = await adjust(fixture, owner, body, key)

    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ amount: 5_000, balance: 5_000, replayed: false })

    const again = await adjust(fixture, owner, body, key)

    expect(again.status).toBe(201)
    expect(again.body).toMatchObject({
      entryId: (first.body as { entryId: string }).entryId,
      balance: 5_000,
      replayed: true,
    })

    // Правка — не покупка: визит и оборот на месте.
    expect(await balanceOf(fixture)).toEqual({
      pointsBalance: 5_000,
      visitsTotal: 0,
      spentTotal: 0,
    })
    expect(
      await prisma.ledgerEntry.count({
        where: { membershipId: fixture.membershipId, type: 'ADJUST' },
      }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: fixture.tenantId,
          action: 'BALANCE_ADJUSTED',
          reason: 'Компенсация за долгое ожидание',
        },
      }),
    ).toBe(1)
  })

  it('СПИСАТЬ БОЛЬШЕ, ЧЕМ ЕСТЬ, НЕЛЬЗЯ — 409 И БАЛАНС НА МЕСТЕ; В ПРЕДЕЛАХ — МОЖНО', async () => {
    const fixture = await createMembershipFixture(prisma)
    const { owner } = tokens(fixture.tenantId)

    await adjust(fixture, owner, { amount: 5_000, reason: 'Подарок к открытию сезона' })

    const tooMuch = await adjust(fixture, owner, {
      amount: -6_000,
      reason: 'Ошибочно начислили вчера',
    })

    expect(tooMuch.status).toBe(409)
    expect(tooMuch.body).toMatchObject({ error: { code: 'INSUFFICIENT_BALANCE' } })
    expect((await balanceOf(fixture)).pointsBalance).toBe(5_000)

    const fine = await adjust(fixture, owner, {
      amount: -3_000,
      reason: 'Ошибочно начислили вчера',
    })

    expect(fine.status).toBe(201)
    expect(fine.body).toMatchObject({ amount: -3_000, balance: 2_000 })
  })

  it('МЕНЕДЖЕРУ — 403; БЕЗ КЛЮЧА, БЕЗ ПРИЧИНЫ ИЛИ НА НОЛЬ — 400; ЧУЖОЙ ГОСТЬ — 404; КЛЮЧ ДЛЯ ДРУГОЙ СУММЫ — 409', async () => {
    const fixture = await createMembershipFixture(prisma)
    const { owner, manager } = tokens(fixture.tenantId)
    const reason = 'Компенсация за долгое ожидание'

    expect((await adjust(fixture, manager, { amount: 5_000, reason })).status).toBe(403)
    expect((await adjust(fixture, owner, { amount: 5_000, reason }, null)).status).toBe(400)
    expect((await adjust(fixture, owner, { amount: 5_000, reason: 'надо' })).status).toBe(400)
    expect((await adjust(fixture, owner, { amount: 0, reason })).status).toBe(400)

    const stranger = tokens(await createTenant(prisma)).owner
    expect((await adjust(fixture, stranger, { amount: 5_000, reason })).status).toBe(404)

    const key = randomUUID()
    await adjust(fixture, owner, { amount: 5_000, reason }, key)
    const reused = await adjust(fixture, owner, { amount: 7_000, reason }, key)

    expect(reused.status).toBe(409)
    expect(reused.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect((await balanceOf(fixture)).pointsBalance).toBe(5_000)
  })
})

describe('Заметка о госте', () => {
  it('МЕНЕДЖЕР ПИШЕТ И СТИРАЕТ ЗАМЕТКУ; ОНА В КАРТОЧКЕ; КАССИРУ — 403; ДЛИННЕЕ 1000 — 400; ЧУЖОЙ — 404', async () => {
    const fixture = await createMembershipFixture(prisma)
    const { manager, cashier } = tokens(fixture.tenantId)
    const note = (text: string, token = manager) =>
      request(server())
        .put(`/v1/admin/guests/${fixture.guestId}/note`)
        .set('Authorization', `Bearer ${token}`)
        .send({ text })

    const written = await note('Аллергия на арахис, любит столик у окна')

    expect(written.status).toBe(200)
    expect(written.body).toEqual({ note: 'Аллергия на арахис, любит столик у окна' })

    const card = await request(server())
      .get(`/v1/admin/guests/${fixture.guestId}`)
      .set('Authorization', `Bearer ${manager}`)
      .expect(200)

    expect((card.body as { note: string | null }).note).toBe(
      'Аллергия на арахис, любит столик у окна',
    )

    expect((await note('   ')).body).toEqual({ note: null })
    expect((await note('Заметка', cashier)).status).toBe(403)
    expect((await note('я'.repeat(1001))).status).toBe(400)

    const stranger = tokens(await createTenant(prisma)).manager
    expect((await note('Чужой гость', stranger)).status).toBe(404)
  })
})
