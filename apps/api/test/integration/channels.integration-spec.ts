import { randomInt, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  createTenant,
  idempotencyKey,
  POS_ORIGIN,
} from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Источники трафика. docs/02, разделы 2.6 и 5.9 · docs/11, У7.
 *
 * Полигон: заведение с постоянным гостем, пришедшим на кассе ещё до табличек, новичок
 * и посторонний гость без участия. У соседнего заведения — свой источник со своим
 * кодом: он настоящий, но в нашем заведении не открывает ничего.
 */

const SECRET = 'channels-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let tenantId: string
let regular: MembershipFixture
let neighbour: MembershipFixture
let newcomerId: string
let strangerId: string
let ownerToken: string
let managerToken: string
let cashierToken: string
let neighbourOwnerToken: string
let table: ChannelBody
let flyer: ChannelBody

const server = (): Server => app.getHttpServer() as Server

interface ChannelBody {
  id: string
  name: string
  code: string
  isActive: boolean
}

interface Counts {
  guests: number
  buyers: number
  revenue: number
}

interface ReportBody {
  period: string
  channels: Array<Counts & { channelId: string; isActive: boolean }>
  unattributed: Counts
}

interface ErrorBody {
  error: { code: string }
}

const bearer = (token: string): string => `Bearer ${token}`

const createChannel = (token: string, name: string) =>
  request(server()).post('/v1/admin/channels').set('Authorization', bearer(token)).send({ name })

const join = (guestId: string, venue: string, channel: string) =>
  request(server())
    .post(`/v1/guest/venues/${venue}/join`)
    .set('Authorization', bearer(signGuestToken({ guestId }, SECRET)))
    .send({ channel })

const report = (token: string, period = '7d') =>
  request(server())
    .get(`/v1/admin/reports/channels?period=${period}`)
    .set('Authorization', bearer(token))

const createGuest = async (): Promise<string> => {
  const guest = await prisma.guest.create({
    data: { phoneE164: `+66${String(randomInt(100_000_000, 999_999_999))}`, locale: 'ru' },
    select: { id: true },
  })

  return guest.id
}

const membershipOf = async (guestId: string) =>
  prisma.forTenant(tenantId, async (tx) =>
    tx.membership.findFirst({
      where: { tenantId, guestId },
      select: { id: true, source: true, channelId: true },
    }),
  )

const earn = async (membershipId: string, basisAmount: number): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId,
      amount: Math.floor(basisAmount / 20),
      basisAmount,
      idempotencyKey: idempotencyKey('channel-check'),
      refType: 'receipt',
      refId: `ch-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    { tenantId },
  )

  return result.entry.id
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
  ledger = moduleRef.get(LedgerService)

  tenantId = await createTenant(prisma)
  regular = await createMembershipFixture(prisma, { tenantId })
  neighbour = await createMembershipFixture(prisma)
  newcomerId = await createGuest()
  strangerId = await createGuest()

  const sign = (tenant: string, role: string): string =>
    signAccessToken({ tenantId: tenant, actorId: null, role }, SECRET)

  ownerToken = sign(tenantId, 'OWNER')
  managerToken = sign(tenantId, 'MANAGER')
  cashierToken = sign(tenantId, 'CASHIER')
  neighbourOwnerToken = sign(neighbour.tenantId, 'OWNER')
})

afterAll(async () => {
  await app.close()
})

describe('Источники: справочник', () => {
  it('ВЛАДЕЛЕЦ ЗАВОДИТ ИСТОЧНИК — КОД ССЫЛКИ ВЫДАЁТ СЕРВЕР', async () => {
    const created = await createChannel(ownerToken, 'Табличка на столе')

    expect(created.status).toBe(201)
    table = created.body as ChannelBody
    expect(table).toMatchObject({ name: 'Табличка на столе', isActive: true })
    expect(table.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
  })

  it('менеджер видит список, но завести не может; то же название в другом регистре — 409', async () => {
    const list = await request(server())
      .get('/v1/admin/channels')
      .set('Authorization', bearer(managerToken))
    expect(list.status).toBe(200)
    expect((list.body as ChannelBody[]).map((channel) => channel.id)).toContain(table.id)

    expect((await createChannel(managerToken, 'Instagram')).status).toBe(403)

    const duplicate = await createChannel(ownerToken, 'табличка НА СТОЛЕ')
    expect(duplicate.status).toBe(409)
    expect((duplicate.body as ErrorBody).error.code).toBe('CHANNEL_EXISTS')
  })

  it('чужой источник не изменить и не увидеть', async () => {
    const patched = await request(server())
      .patch(`/v1/admin/channels/${table.id}`)
      .set('Authorization', bearer(neighbourOwnerToken))
      .send({ isActive: false })
    expect(patched.status).toBe(404)

    const list = await request(server())
      .get('/v1/admin/channels')
      .set('Authorization', bearer(neighbourOwnerToken))
    expect((list.body as ChannelBody[]).map((channel) => channel.id)).not.toContain(table.id)
  })
})

describe('Источники: вступление по ссылке', () => {
  it('НОВЫЙ ГОСТЬ ПО ССЫЛКЕ ТАБЛИЧКИ СТАНОВИТСЯ ГОСТЕМ С ЭТИМ ИСТОЧНИКОМ', async () => {
    const response = await join(newcomerId, tenantId, table.code.toLowerCase())

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ tenantId, joined: true })
    expect(await membershipOf(newcomerId)).toMatchObject({
      source: 'ORGANIC',
      channelId: table.id,
    })
  })

  it('ПЕРВОЕ КАСАНИЕ: ПОСТОЯННЫЙ ГОСТЬ, ОТСКАНИРОВАВШИЙ ТАБЛИЧКУ, ИСТОЧНИК НЕ МЕНЯЕТ', async () => {
    const regularJoin = await join(regular.guestId, tenantId, table.code)
    expect(regularJoin.body).toMatchObject({ joined: false })
    expect((await membershipOf(regular.guestId))?.channelId).toBeNull()

    const again = await join(newcomerId, tenantId, table.code)
    expect(again.body).toMatchObject({ joined: false })
  })

  it('ЧУЖОЙ КОД, ВЫКЛЮЧЕННЫЙ ИСТОЧНИК И КОД НЕ ПО ФОРМЕ НЕ ОТКРЫВАЮТ НИЧЕГО', async () => {
    const instagram = (await createChannel(neighbourOwnerToken, 'Instagram')).body as ChannelBody

    const cross = await join(strangerId, tenantId, instagram.code)
    expect(cross.status).toBe(404)
    expect((cross.body as ErrorBody).error.code).toBe('CHANNEL_NOT_FOUND')

    // Наш настоящий код под адресом соседнего заведения.
    expect((await join(strangerId, neighbour.tenantId, table.code)).status).toBe(404)

    flyer = (await createChannel(ownerToken, 'Флаер на пляже')).body as ChannelBody
    const switchedOff = await request(server())
      .patch(`/v1/admin/channels/${flyer.id}`)
      .set('Authorization', bearer(ownerToken))
      .send({ isActive: false })
    expect(switchedOff.body).toMatchObject({ isActive: false })
    expect((await join(strangerId, tenantId, flyer.code)).status).toBe(404)

    expect((await join(strangerId, tenantId, 'IO01')).status).toBe(400)
    expect(await membershipOf(strangerId)).toBeNull()
  })
})

describe('Источники: отчёт', () => {
  it('ГОСТЬ ИЗ ТАБЛИЧКИ ВИДЕН В СТРОКЕ ИСТОЧНИКА СО СВОЕЙ ВЫРУЧКОЙ — ОТМЕНЁННЫЙ ЧЕК НЕ В СЧЁТ', async () => {
    const newcomer = await membershipOf(newcomerId)
    if (newcomer === null) {
      throw new Error('новичок не вступил — предыдущий тест упал')
    }

    await earn(newcomer.id, 50_000)
    const voided = await earn(newcomer.id, 30_000)
    await ledger.reverse(
      {
        entryId: voided,
        idempotencyKey: idempotencyKey('channel-void'),
        reason: 'RECEIPT_VOIDED',
        ...POS_ORIGIN,
      },
      { tenantId },
    )
    await earn(regular.membershipId, 20_000)

    const response = await report(managerToken)
    expect(response.status).toBe(200)

    const body = response.body as ReportBody
    expect(body.period).toBe('7d')
    // Выручка сверху: табличка принесла деньги, выключенный флаер — нет.
    expect(body.channels.map((row) => row.channelId)).toEqual([table.id, flyer.id])
    expect(body.channels[0]).toMatchObject({ guests: 1, buyers: 1, revenue: 50_000 })
    expect(body.channels[1]).toMatchObject({ isActive: false, guests: 0, buyers: 0, revenue: 0 })
    expect(body.unattributed).toEqual({ guests: 1, buyers: 1, revenue: 20_000 })
  })

  it('кассиру отчёт закрыт, неизвестный период — 400, соседу наши источники не видны', async () => {
    expect((await report(cashierToken)).status).toBe(403)
    expect((await report(ownerToken, '1y')).status).toBe(400)

    const foreign = (await report(neighbourOwnerToken, '30d')).body as ReportBody
    expect(foreign.channels.map((row) => row.channelId)).not.toContain(table.id)
  })

  it('КАРТОЧКА ГОСТЯ ПОКАЗЫВАЕТ ИСТОЧНИК, У ГОСТЯ С КАССЫ ЕГО НЕТ', async () => {
    const card = async (guestId: string): Promise<unknown> =>
      (
        (
          await request(server())
            .get(`/v1/admin/guests/${guestId}`)
            .set('Authorization', bearer(managerToken))
        ).body as { channel: unknown }
      ).channel

    expect(await card(newcomerId)).toEqual({ id: table.id, name: 'Табличка на столе' })
    expect(await card(regular.guestId)).toBeNull()
  })
})
