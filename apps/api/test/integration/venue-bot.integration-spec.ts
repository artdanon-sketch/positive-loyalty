import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { BroadcastSendService } from '../../src/admin/broadcast-send.service'
import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { PushService } from '../../src/identity/push.service'
import { TelegramApiFactory } from '../../src/identity/telegram-api.factory'
import { TelegramBotService } from '../../src/identity/telegram-bot.service'
import { VenueBotLinkService } from '../../src/identity/venue-bot-link.service'

import { createMembershipFixture, type MembershipFixture } from './ledger-test-context'

/**
 * Свой бот заведения. docs/02, разделы 5.18 и 2.14.
 *
 * Telegram подменён: настоящий бот в тестах недоступен, а проверять надо наше —
 * принят ли ключ, кому связался чат и каким каналом ушла рассылка.
 *
 * Главное здесь: рассылка уходит через бота заведения, когда гость его
 * запустил. Ради этого всё и делалось.
 */

const SECRET = 'venue-bot-secret-not-used-anywhere-else'
const GOOD_TOKEN = `1234567890:${'a'.repeat(35)}`
const BAD_TOKEN = `9876543210:${'b'.repeat(35)}`

let app: INestApplication
let prisma: PrismaService
let links: VenueBotLinkService
let sender: BroadcastSendService
let guest: MembershipFixture
let tenantId: string
let ownerToken: string
let guestToken: string

const sent: Array<{ chatId: string; text: string }> = []

const server = (): Server => app.getHttpServer() as Server

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  // Фабрика клиентов Telegram: хороший ключ отвечает, плохой отвергается.
  const factoryStub = {
    for: (token: string) => ({
      getMe: () => {
        if (token !== GOOD_TOKEN) {
          throw new Error('Unauthorized')
        }

        return Promise.resolve({ id: 1, username: 'kata_beach_bot' })
      },
      sendMessage: (chatId: string, text: string) => {
        sent.push({ chatId, text })

        return Promise.resolve()
      },
    }),
  }

  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TelegramApiFactory)
    .useValue(factoryStub)
    // Общий бот выключен: проверяем, что заведение пишет своим.
    .overrideProvider(TelegramBotService)
    .useValue({ enabled: false, api: { sendMessage: vi.fn() } })
    .overrideProvider(PushService)
    .useValue({
      enabled: false,
      publicKey: '',
      sendToGuest: vi.fn(() => Promise.resolve('нет устройств')),
    })
    .compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  links = moduleRef.get(VenueBotLinkService)
  sender = moduleRef.get(BroadcastSendService)

  guest = await createMembershipFixture(prisma)
  tenantId = guest.tenantId

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  guestToken = signGuestToken({ guestId: guest.guestId }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Бот заведения: подключение', () => {
  it('НЕРАБОЧИЙ КЛЮЧ НЕ СОХРАНЯЕТСЯ: ИНАЧЕ РАССЫЛКИ ТИХО ВЫКЛЮЧАЮТСЯ', async () => {
    const response = await request(server())
      .put('/v1/admin/bot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ token: BAD_TOKEN })

    expect(response.status).toBe(400)
    expect(await prisma.venueBot.count({ where: { tenantId } })).toBe(0)
  })

  it('РАБОЧИЙ КЛЮЧ ПРИНИМАЕТСЯ, ИМЯ БОТА СПРАШИВАЕТСЯ У TELEGRAM', async () => {
    const response = await request(server())
      .put('/v1/admin/bot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ token: GOOD_TOKEN })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ connected: true, username: 'kata_beach_bot' })
  })

  it('КЛЮЧ ОБРАТНО НЕ ПОКАЗЫВАЕТСЯ — ТОЛЬКО ХВОСТ', async () => {
    const response = await request(server())
      .get('/v1/admin/bot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const body = response.body as { tokenMasked: string }
    expect(body.tokenMasked).toBe(`••••${GOOD_TOKEN.slice(-4)}`)
    expect(body.tokenMasked).not.toContain('1234567890')
  })
})

describe('Бот заведения: подключение гостя', () => {
  it('ГОСТЬ ПОЛУЧАЕТ ССЫЛКУ НА БОТА ЭТОГО ЗАВЕДЕНИЯ', async () => {
    const response = await request(server())
      .post(`/v1/guest/venues/${tenantId}/bot/invite`)
      .set('Authorization', `Bearer ${guestToken}`)

    expect(response.status).toBe(201)
    expect((response.body as { url: string }).url).toContain('t.me/kata_beach_bot?start=')
  })

  it('КОД ИЗ ССЫЛКИ СВЯЗЫВАЕТ ЧАТ С КАРТОЙ — И РАБОТАЕТ ОДИН РАЗ', async () => {
    const response = await request(server())
      .post(`/v1/guest/venues/${tenantId}/bot/invite`)
      .set('Authorization', `Bearer ${guestToken}`)
      .expect(201)

    const code = new URL((response.body as { url: string }).url).searchParams.get('start') ?? ''

    expect(await links.claim(tenantId, code, '555001')).toMatchObject({ guestId: guest.guestId })
    // Второй раз тот же код не сработает: он одноразовый.
    expect(await links.claim(tenantId, code, '555002')).toBeNull()

    const chat = await prisma.venueBotChat.findFirst({
      where: { tenantId, guestId: guest.guestId },
      select: { chatId: true },
    })
    expect(chat?.chatId).toBe('555001')
  })

  it('ЧУЖОЙ КОД НЕ ПОДХОДИТ', async () => {
    expect(await links.claim(tenantId, randomUUID(), '555003')).toBeNull()
  })
})

describe('Бот заведения: рассылка', () => {
  it('УХОДИТ ЧЕРЕЗ БОТА ЗАВЕДЕНИЯ, И ЭТО ВИДНО В АРХИВЕ', async () => {
    const created = await request(server())
      .post('/v1/admin/broadcasts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'От своего бота', text: 'Заходите на кофе' })
      .expect(201)

    const broadcastId = (created.body as { id: string }).id

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const left = await prisma.broadcastRecipient.count({
        where: { broadcastId, delivery: 'PENDING' },
      })

      if (left === 0) {
        break
      }

      await sender.tick()
    }

    const row = await prisma.broadcastRecipient.findFirst({
      where: { broadcastId, guestId: guest.guestId },
      select: { delivery: true, channel: true },
    })

    expect(row).toMatchObject({ delivery: 'SENT', channel: 'VENUE_BOT' })
    expect(sent.at(-1)).toMatchObject({ chatId: '555001', text: 'Заходите на кофе' })
  })

  it('ОТКЛЮЧЁННЫЙ БОТ НЕ ТЕРЯЕТ ПОДПИСЧИКОВ', async () => {
    await request(server())
      .delete('/v1/admin/bot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const response = await request(server())
      .get('/v1/admin/bot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    expect(response.body).toMatchObject({ connected: false, subscribers: 1 })
  })
})
