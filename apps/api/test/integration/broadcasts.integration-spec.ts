import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppModule } from '../../src/app.module'
import { BroadcastSendService } from '../../src/admin/broadcast-send.service'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { TelegramBotService } from '../../src/identity/telegram-bot.service'

import {
  createLedgerTestContext,
  createMembershipFixture,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Рассылки. docs/02, раздел 5.4 · docs/03, раздел 5.
 *
 * Полигон: заведение с тремя гостями — у одного связан Telegram, у второго тоже,
 * но он уже получил свои четыре сообщения за месяц, у третьего Telegram нет.
 * Соседнее заведение со своим гостем.
 *
 * Telegram подменён: настоящий бот в тестах недоступен, а проверять надо наше —
 * кому ушло, кому не ушло и почему.
 */

const SECRET = 'broadcast-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let sender: BroadcastSendService
let reachable: MembershipFixture
let tired: MembershipFixture
let neighbour: MembershipFixture
let ownerToken: string
let managerToken: string
let neighbourOwnerToken: string
let broadcastId: string

const sentMessages: Array<{ chatId: string; text: string }> = []
const blocked = new Set<string>()

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`

interface PreviewBody {
  found: number
  willReceive: number
  tired: number
  unreachable: number
}

interface BroadcastBody {
  id: string
  title: string
  status: string
  total: number
  sent: number
  failed: number
  tired: number
  unreachable: number
}

const preview = (token: string, audience: Record<string, unknown> = {}) =>
  request(server())
    .post('/v1/admin/broadcasts/preview')
    .set('Authorization', bearer(token))
    .send({ audience })

const createBroadcast = (token: string, body: Record<string, unknown>) =>
  request(server()).post('/v1/admin/broadcasts').set('Authorization', bearer(token)).send(body)

interface BroadcastsListBody {
  total: number
  items: BroadcastBody[]
}

const listBroadcasts = async (token: string): Promise<BroadcastsListBody> => {
  const response = await request(server())
    .get('/v1/admin/broadcasts')
    .set('Authorization', bearer(token))

  return response.body as BroadcastsListBody
}

/** Связать гостю Telegram: рассылка ходит по этому идентификатору. */
const linkTelegram = async (guestId: string, chatId: string): Promise<void> => {
  await prisma.guestIdentity.create({
    data: { guestId, provider: 'TELEGRAM', externalId: chatId },
  })
}

/** Настоящий PrismaService под ролью приложения — приём из ledger-app-role. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — политики рассылок не проверить.')
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

  const telegramStub = {
    enabled: true,
    api: {
      sendMessage: vi.fn(async (chatId: string, text: string) => {
        if (blocked.has(chatId)) {
          throw new Error('Forbidden: bot was blocked by the user')
        }

        sentMessages.push({ chatId, text })
        await Promise.resolve()
      }),
    },
  }

  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TelegramBotService)
    .useValue(telegramStub)
    .compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  sender = moduleRef.get(BroadcastSendService)

  reachable = await createMembershipFixture(prisma)
  tired = await createMembershipFixture(prisma, { tenantId: reachable.tenantId })
  // Третий гость — без Telegram: ему слать некуда, и это должно быть видно заранее.
  await createMembershipFixture(prisma, { tenantId: reachable.tenantId })
  neighbour = await createMembershipFixture(prisma)

  const stamp = String(Date.now()).slice(-8)
  await linkTelegram(reachable.guestId, `10${stamp}`)
  await linkTelegram(tired.guestId, `20${stamp}`)
  await linkTelegram(neighbour.guestId, `30${stamp}`)

  // Усталость: четыре доставленных сообщения за последние тридцать дней. Четыре
  // сообщения — это четыре рассылки: в одной гость встречается ровно один раз.
  for (const day of [2, 5, 9, 14]) {
    const past = await prisma.broadcast.create({
      data: {
        tenantId: reachable.tenantId,
        title: `Прошлая ${String(day)}`,
        text: 'Прошлое сообщение',
        audience: {},
        sendAt: new Date(Date.now() - day * DAY_MS),
        status: 'SENT',
      },
      select: { id: true },
    })

    await prisma.broadcastRecipient.create({
      data: {
        tenantId: reachable.tenantId,
        broadcastId: past.id,
        guestId: tired.guestId,
        delivery: 'SENT',
        channel: 'TELEGRAM',
        sentAt: new Date(Date.now() - day * DAY_MS),
      },
    })
  }

  const sign = (tenantId: string, role: string): string =>
    signAccessToken({ tenantId, actorId: null, role }, SECRET)

  ownerToken = sign(reachable.tenantId, 'OWNER')
  managerToken = sign(reachable.tenantId, 'MANAGER')
  neighbourOwnerToken = sign(neighbour.tenantId, 'OWNER')
})

afterAll(async () => {
  await app.close()
})

describe('Рассылки: предпросмотр', () => {
  it('СЧИТАЕТ, СКОЛЬКО НАШЛОСЬ И СКОЛЬКО ИЗ НИХ ПОЛУЧИТ: УСТАВШИЕ И БЕЗ TELEGRAM ОТДЕЛЬНО', async () => {
    const response = await preview(ownerToken)

    expect(response.status).toBe(200)
    const body = response.body as PreviewBody

    expect(body.found).toBe(3)
    expect(body.willReceive).toBe(1)
    expect(body.tired).toBe(1)
    expect(body.unreachable).toBe(1)
  })

  it('ФИЛЬТР СУЖАЕТ АУДИТОРИЮ; НЕИЗВЕСТНЫЙ ФИЛЬТР — 400', async () => {
    const narrow = await preview(ownerToken, { buyers: 'none' })
    expect((narrow.body as PreviewBody).found).toBe(3)

    const bad = await request(server())
      .post('/v1/admin/broadcasts/preview')
      .set('Authorization', bearer(ownerToken))
      .send({ audience: { sleeping: 2 } })
    expect(bad.status).toBe(400)
  })

  it('СОСЕДНЕЕ ЗАВЕДЕНИЕ СЧИТАЕТ СВОИХ; МЕНЕДЖЕРУ РАССЫЛКИ ЗАКРЫТЫ', async () => {
    expect((await preview(neighbourOwnerToken)).body).toMatchObject({ found: 1 })
    expect((await preview(managerToken)).status).toBe(403)
  })
})

describe('Рассылки: создание и отправка', () => {
  it('СНИМОК АУДИТОРИИ ПИШЕТСЯ СРАЗУ: КТО УСТАЛ И КОМУ НЕКУДА СЛАТЬ — УЖЕ ВИДНО', async () => {
    const created = await createBroadcast(ownerToken, {
      title: 'Осенняя',
      text: 'Скучаем! Заходите на кофе.',
    })

    expect(created.status).toBe(201)
    const body = created.body as BroadcastBody
    broadcastId = body.id

    expect(body).toMatchObject({
      title: 'Осенняя',
      status: 'SCHEDULED',
      total: 3,
      sent: 0,
      tired: 1,
      unreachable: 1,
    })
  })

  it('ПРОХОД ОТПРАВЛЯЕТ ТОЛЬКО ЖИВЫМ И ЗАКРЫВАЕТ РАССЫЛКУ', async () => {
    sentMessages.length = 0

    await sender.tick()
    // Второй проход закрывает рассылку: получателей в ожидании не осталось.
    await sender.tick()

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.text).toBe('Скучаем! Заходите на кофе.')

    const items = (await listBroadcasts(ownerToken)).items
    const sent = items.find((item) => item.id === broadcastId)

    expect(sent).toMatchObject({ status: 'SENT', sent: 1, failed: 0, tired: 1, unreachable: 1 })
  })

  it('ОТПРАВЛЕННОЕ ДОБАВЛЯЕТ УСТАЛОСТИ: ТЕПЕРЬ ПОЛУЧАТЕЛЬ БЛИЖЕ К ПРЕДЕЛУ', async () => {
    const body = (await preview(ownerToken)).body as PreviewBody

    // Тот же расклад: одно отправленное из четырёх ещё не предел.
    expect(body).toMatchObject({ found: 3, willReceive: 1, tired: 1, unreachable: 1 })
  })

  it('ГОСТЬ ЗАБЛОКИРОВАЛ БОТА — ЭТО СУДЬБА ОДНОГО ПОЛУЧАТЕЛЯ, А НЕ ПОЛОМКА РАССЫЛКИ', async () => {
    const identity = await prisma.guestIdentity.findFirstOrThrow({
      where: { guestId: reachable.guestId, provider: 'TELEGRAM' },
      select: { externalId: true },
    })
    blocked.add(identity.externalId)

    const created = await createBroadcast(ownerToken, {
      title: 'Вторая',
      text: 'Ещё раз здравствуйте',
    })
    const id = (created.body as BroadcastBody).id

    await sender.tick()
    await sender.tick()

    const failed = (await listBroadcasts(ownerToken)).items.find((item) => item.id === id)
    expect(failed).toMatchObject({ status: 'SENT', sent: 0, failed: 1 })

    blocked.delete(identity.externalId)
  })

  it('ОТЛОЖЕННАЯ РАССЫЛКА ЖДЁТ СВОЕГО ВРЕМЕНИ', async () => {
    const created = await createBroadcast(ownerToken, {
      title: 'На завтра',
      text: 'Завтра будет повод',
      sendAt: new Date(Date.now() + DAY_MS).toISOString(),
    })
    const id = (created.body as BroadcastBody).id

    sentMessages.length = 0
    await sender.tick()

    expect(sentMessages).toHaveLength(0)
    const waiting = (await listBroadcasts(ownerToken)).items.find((item) => item.id === id)
    expect(waiting).toMatchObject({ status: 'SCHEDULED', sent: 0 })
  })

  it('ЧУЖИЕ РАССЫЛКИ НЕ ВИДНЫ, МЕНЕДЖЕР НЕ СОЗДАЁТ, ПУСТОЙ ТЕКСТ — 400', async () => {
    expect((await listBroadcasts(neighbourOwnerToken)).total).toBe(0)
    expect((await createBroadcast(managerToken, { title: 'Своя', text: 'Текст' })).status).toBe(403)
    expect((await createBroadcast(ownerToken, { title: 'Пустая', text: ' ' })).status).toBe(400)
  })
})

describe('Рассылки: политики RLS под ролью приложения', () => {
  let appRole: LedgerTestContext

  beforeAll(async () => {
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('РАССЫЛКИ И ПОЛУЧАТЕЛИ ВИДНЫ ТОЛЬКО СВОЕМУ ЗАВЕДЕНИЮ', async () => {
    const find = { where: { id: broadcastId }, select: { id: true } } as const

    expect(await appRole.prisma.broadcast.findMany(find)).toEqual([])
    expect(
      await appRole.prisma.forTenant(reachable.tenantId, async (tx) => tx.broadcast.findMany(find)),
    ).toEqual([{ id: broadcastId }])
    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) => tx.broadcast.findMany(find)),
    ).toEqual([])

    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) =>
        tx.broadcastRecipient.findMany({ where: { broadcastId }, select: { id: true } }),
      ),
    ).toEqual([])
  })

  it('ГОСТЬ РАССЫЛОК НЕ ВИДИТ ВОВСЕ', async () => {
    expect(
      await appRole.prisma.forGuest(reachable.guestId, async (tx) =>
        tx.broadcast.findMany({ where: { id: broadcastId }, select: { id: true } }),
      ),
    ).toEqual([])
  })
})
