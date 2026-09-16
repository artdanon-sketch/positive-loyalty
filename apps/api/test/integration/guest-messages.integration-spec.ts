import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createLedgerTestContext,
  createMembershipFixture,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Жалобы и предложения. docs/02, разделы 2.10 и 5.15.
 *
 * Полигон: заведение с гостем, соседнее заведение со своим гостем и гость без участий.
 * HTTP-проверки ходят владельцем базы, которого RLS не касается, — политики
 * `GuestMessage` проверены отдельно, под ролью приложения (последний блок).
 */

const SECRET = 'messages-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let venue: MembershipFixture
let neighbour: MembershipFixture
let strangerId: string
let ownerToken: string
let managerToken: string
let cashierToken: string
let neighbourOwnerToken: string
let messageId: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`

interface MessageBody {
  id: string
  kind: string
  text: string
  reply: string | null
  guest?: { membershipId: string | null; phone: string | null }
}

interface ListBody {
  total: number
  unanswered: number
  items: MessageBody[]
}

const write = (guestId: string, body: Record<string, unknown>) =>
  request(server())
    .post('/v1/guest/messages')
    .set('Authorization', bearer(signGuestToken({ guestId }, SECRET)))
    .send(body)

const mine = async (guestId: string): Promise<{ items: MessageBody[] }> =>
  (
    await request(server())
      .get('/v1/guest/messages')
      .set('Authorization', bearer(signGuestToken({ guestId }, SECRET)))
  ).body as { items: MessageBody[] }

const list = async (token: string, query = ''): Promise<ListBody> =>
  (await request(server()).get(`/v1/admin/messages${query}`).set('Authorization', bearer(token)))
    .body as ListBody

const reply = (token: string, id: string, text: string) =>
  request(server())
    .post(`/v1/admin/messages/${id}/reply`)
    .set('Authorization', bearer(token))
    .send({ text })

/** Настоящий PrismaService под ролью приложения — приём из ledger-app-role. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — политики GuestMessage не проверить.')
  }

  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = url

  try {
    return await createLedgerTestContext()
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL']
    } else {
      process.env['DATABASE_URL'] = previous
    }
  }
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

  venue = await createMembershipFixture(prisma)
  neighbour = await createMembershipFixture(prisma)
  strangerId = (await prisma.guest.create({ data: { locale: 'ru' }, select: { id: true } })).id

  await prisma.guest.update({
    where: { id: venue.guestId },
    data: { displayName: 'Гость Аня', phoneE164: `+6681${String(Date.now()).slice(-7)}` },
  })

  const sign = (tenantId: string, role: string): string =>
    signAccessToken({ tenantId, actorId: null, role }, SECRET)

  ownerToken = sign(venue.tenantId, 'OWNER')
  managerToken = sign(venue.tenantId, 'MANAGER')
  cashierToken = sign(venue.tenantId, 'CASHIER')
  neighbourOwnerToken = sign(neighbour.tenantId, 'OWNER')
})

afterAll(async () => {
  await app.close()
})

describe('Обращения: гость пишет, заведение отвечает', () => {
  it('ЖАЛОБА ДОХОДИТ ДО ЗАВЕДЕНИЯ, ОТВЕТ ВОЗВРАЩАЕТСЯ ГОСТЮ', async () => {
    const created = await write(venue.guestId, {
      tenantId: venue.tenantId,
      kind: 'COMPLAINT',
      text: 'Кондиционер не работает второй день',
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'COMPLAINT', reply: null })
    messageId = (created.body as MessageBody).id

    const inbox = await list(ownerToken)
    expect(inbox.total).toBe(1)
    expect(inbox.unanswered).toBe(1)
    expect(inbox.items[0]).toMatchObject({
      id: messageId,
      kind: 'COMPLAINT',
      guest: { membershipId: venue.membershipId },
    })

    const replied = await reply(ownerToken, messageId, 'Починили, извините за неудобства')
    expect(replied.status).toBe(200)
    expect(replied.body).toMatchObject({ reply: 'Починили, извините за неудобства' })

    expect((await mine(venue.guestId)).items[0]).toMatchObject({
      id: messageId,
      reply: 'Починили, извините за неудобства',
    })
    expect((await list(ownerToken)).unanswered).toBe(0)
  })

  it('ТРИ БЕЗ ОТВЕТА — БОЛЬШЕ НЕ ПРИНИМАЕМ; ОТВЕТИЛИ — СНОВА МОЖНО', async () => {
    const suggestion = { tenantId: venue.tenantId, kind: 'SUGGESTION' as const }

    for (const n of [1, 2, 3]) {
      const sent = await write(venue.guestId, { ...suggestion, text: `Идея ${String(n)}` })
      expect(sent.status).toBe(201)
    }

    const blocked = await write(venue.guestId, { ...suggestion, text: 'Идея 4' })
    expect(blocked.status).toBe(409)
    expect((blocked.body as { error: { code: string } }).error.code).toBe('MESSAGE_LIMIT_REACHED')

    const pending = (await list(ownerToken, '?answered=no')).items
    expect(pending).toHaveLength(3)
    await reply(ownerToken, pending[0]?.id ?? '', 'Спасибо, подумаем')

    const again = await write(venue.guestId, { ...suggestion, text: 'Идея 5' })
    expect(again.status).toBe(201)
  })

  it('ЧУЖОМУ ЗАВЕДЕНИЮ НЕ НАПИШЕШЬ, ЧУЖИЕ ОБРАЩЕНИЯ НЕ ПРОЧТЁШЬ', async () => {
    // Гость без участия — заведение его не знает.
    const stranger = await write(strangerId, {
      tenantId: venue.tenantId,
      kind: 'COMPLAINT',
      text: 'Здравствуйте',
    })
    expect(stranger.status).toBe(404)
    expect((await mine(strangerId)).items).toEqual([])

    // Сосед видит только свои обращения и чужое не тронет.
    expect((await list(neighbourOwnerToken)).total).toBe(0)
    expect((await reply(neighbourOwnerToken, messageId, 'Перехват')).status).toBe(404)
  })

  it('МЕНЕДЖЕР ВИДИТ ОБРАЩЕНИЯ С МАСКИРОВАННЫМ ТЕЛЕФОНОМ, КАССИР — НЕ ВИДИТ ВОВСЕ', async () => {
    const full = (
      await prisma.guest.findUniqueOrThrow({
        where: { id: venue.guestId },
        select: { phoneE164: true },
      })
    ).phoneE164

    const asManager = await list(managerToken, '?kind=COMPLAINT')
    expect(asManager.items[0]?.guest?.phone).not.toBe(full)
    expect(asManager.items[0]?.guest?.phone).toContain('•')

    const asOwner = await list(ownerToken, '?kind=COMPLAINT')
    expect(asOwner.items[0]?.guest?.phone).toBe(full)

    const forbidden = await request(server())
      .get('/v1/admin/messages')
      .set('Authorization', bearer(cashierToken))
    expect(forbidden.status).toBe(403)
  })

  it('ПУСТОЙ ТЕКСТ, НЕИЗВЕСТНЫЙ ВИД И ПУСТОЙ ОТВЕТ — 400', async () => {
    const empty = await write(venue.guestId, {
      tenantId: venue.tenantId,
      kind: 'COMPLAINT',
      text: ' ',
    })
    expect(empty.status).toBe(400)

    const unknown = await write(venue.guestId, {
      tenantId: venue.tenantId,
      kind: 'PRAISE',
      text: 'Молодцы',
    })
    expect(unknown.status).toBe(400)

    expect((await reply(ownerToken, messageId, '   ')).status).toBe(400)
  })
})

describe('Обращения: политики RLS под ролью приложения', () => {
  let appRole: LedgerTestContext

  beforeAll(async () => {
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('ГОСТЬ ПИШЕТ ТОЛЬКО ЗА СЕБЯ И ТОЛЬКО СВОЕМУ ЗАВЕДЕНИЮ; ОТВЕТ СЕБЕ НЕ ПРОСТАВИТ', async () => {
    const own = { tenantId: venue.tenantId, kind: 'COMPLAINT' as const, text: 'Своё' }

    const created = await appRole.prisma.forGuest(venue.guestId, async (tx) =>
      tx.guestMessage.create({ data: { ...own, guestId: venue.guestId }, select: { id: true } }),
    )
    expect(created.id).toBeTruthy()

    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.guestMessage.create({ data: { ...own, guestId: neighbour.guestId } }),
      ),
    ).rejects.toThrow(/row-level security/i)

    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.guestMessage.create({
          data: { ...own, tenantId: neighbour.tenantId, guestId: venue.guestId },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)

    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.guestMessage.create({
          data: { ...own, guestId: venue.guestId, reply: 'Сам себе ответил' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('ЧУЖИЕ ОБРАЩЕНИЯ НЕ ЧИТАЮТСЯ НИ ГОСТЕМ, НИ СОСЕДНИМ ЗАВЕДЕНИЕМ', async () => {
    const find = { where: { id: messageId }, select: { id: true } } as const

    expect(await appRole.prisma.guestMessage.findMany(find)).toEqual([])
    expect(
      await appRole.prisma.forGuest(venue.guestId, async (tx) => tx.guestMessage.findMany(find)),
    ).toEqual([{ id: messageId }])
    expect(
      await appRole.prisma.forGuest(neighbour.guestId, async (tx) =>
        tx.guestMessage.findMany(find),
      ),
    ).toEqual([])
    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) =>
        tx.guestMessage.findMany(find),
      ),
    ).toEqual([])
  })
})
