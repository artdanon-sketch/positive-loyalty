import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { LedgerService } from '../../src/core/ledger.service'

import { createMembershipFixture, idempotencyKey, POS_ORIGIN } from './ledger-test-context'

/**
 * Списки бэк-офиса: гости заведения.
 * docs/03, разделы 1 и 3 · docs/05, раздел 3 (маска телефона по роли).
 *
 * Токены подписываются напрямую, без прохода через PIN: сам вход исчерпывающе
 * проверен в auth-staff.integration-spec, и повторять его здесь — значит
 * привязать тесты списков к устройствам, которые им не нужны.
 */

const SECRET = 'admin-lists-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let guestPhone: string
let ownToken: string
let ownerToken: string
let cashierToken: string
let foreignMembershipId: string

const server = (): Server => app.getHttpServer() as Server

interface GuestsBody {
  items: Array<{
    membershipId: string
    phone: string
    pointsBalance: number
    lastVisitAt: string | null
  }>
  total: number
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  const ledger = moduleRef.get(LedgerService)

  const own = await createMembershipFixture(prisma)
  tenantId = own.tenantId

  const guest = await prisma.guest.findFirstOrThrow({ where: { id: own.guestId } })
  guestPhone = guest.phoneE164

  // Один визит, чтобы у гостя появились баллы и дата последнего визита.
  await ledger.earn(
    {
      membershipId: own.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('admin-lists'),
      ...POS_ORIGIN,
    },
    own.scope,
  )

  const foreign = await createMembershipFixture(prisma)
  foreignMembershipId = foreign.membershipId

  const sign = (role: string): string => signAccessToken({ tenantId, actorId: null, role }, SECRET)

  ownToken = sign('MANAGER')
  ownerToken = sign('OWNER')
  cashierToken = sign('CASHIER')
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Список гостей', () => {
  it('менеджер видит гостей своего заведения с маскированным телефоном', async () => {
    const response = await request(server())
      .get('/v1/admin/guests?limit=50')
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(200)

    const body = response.body as GuestsBody
    expect(body.total).toBeGreaterThan(0)

    const row = body.items[0]
    expect(row).toBeDefined()
    // Маска по образцу docs/02: код страны, точки, последние четыре цифры.
    expect(row!.phone).toBe(`${guestPhone.slice(0, 3)} •• •• ${guestPhone.slice(-4)}`)
    expect(row!.phone).not.toBe(guestPhone)
    // Гость с визитом — первый: сортировка по последнему визиту.
    expect(row!.pointsBalance).toBe(5_000)
    expect(row!.lastVisitAt).not.toBeNull()
  })

  it('владелец видит телефон целиком — матрица прав docs/05', async () => {
    const response = await request(server())
      .get('/v1/admin/guests?limit=50')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const body = response.body as GuestsBody
    expect(body.items[0]!.phone).toBe(guestPhone)
  })

  it('чужие участия в списке не появляются', async () => {
    const response = await request(server())
      .get('/v1/admin/guests?limit=100')
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(200)

    const body = response.body as GuestsBody
    expect(body.items.some((row) => row.membershipId === foreignMembershipId)).toBe(false)
  })

  it('кассиру список гостей не положен — 403', async () => {
    await request(server())
      .get('/v1/admin/guests')
      .set('Authorization', `Bearer ${cashierToken}`)
      .expect(403)
  })

  it('постраничность честная: limit=1 отдаёт одну строку и общий счётчик', async () => {
    const response = await request(server())
      .get('/v1/admin/guests?limit=1')
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(200)

    const body = response.body as GuestsBody
    expect(body.items).toHaveLength(1)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })
})
