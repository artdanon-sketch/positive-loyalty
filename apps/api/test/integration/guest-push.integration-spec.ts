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
import { TelegramBotService } from '../../src/identity/telegram-bot.service'

import { createMembershipFixture, type MembershipFixture } from './ledger-test-context'

/**
 * Уведомления в приложении гостя. docs/02, раздел 2.10.
 *
 * Полигон: заведение с двумя гостями — у одного приложение с уведомлениями,
 * у второго нет ничего. Telegram выключен целиком: проверяется именно то, что
 * второй канал работает САМ ПО СЕБЕ, а не подпирает первый.
 *
 * Главное здесь: гость с приложением перестал быть «некуда слать». Ради этого
 * второй канал и делался.
 */

const SECRET = 'guest-push-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let sender: BroadcastSendService
let withApp: MembershipFixture
let alone: MembershipFixture
let tenantId: string
let ownerToken: string
let guestToken: string

const server = (): Server => app.getHttpServer() as Server

const sent: Array<{ guestId: string; title: string; body: string }> = []

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device-1'

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  // Telegram выключен: единственный канал в этом тесте — уведомления.
  const telegramStub = { enabled: false, api: { sendMessage: vi.fn() } }

  const pushStub = {
    enabled: true,
    publicKey: 'BPublicKeyForTestsOnly-0000000000000000000000',
    sendToGuest: vi.fn(async (guestId: string, payload: { title: string; body: string }) => {
      sent.push({ guestId, title: payload.title, body: payload.body })
      await Promise.resolve()

      return null
    }),
  }

  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TelegramBotService)
    .useValue(telegramStub)
    .overrideProvider(PushService)
    .useValue(pushStub)
    .compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  sender = moduleRef.get(BroadcastSendService)

  withApp = await createMembershipFixture(prisma)
  tenantId = withApp.tenantId
  alone = await createMembershipFixture(prisma, { tenantId })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  guestToken = signGuestToken({ guestId: withApp.guestId }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Уведомления: подписка устройства', () => {
  it('ОТКРЫТЫЙ КЛЮЧ ОТДАЁТСЯ ГОСТЮ — БЕЗ НЕГО ПОДПИСАТЬСЯ НЕ НА ЧТО', async () => {
    const response = await request(server())
      .get('/v1/guest/push/config')
      .set('Authorization', `Bearer ${guestToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ enabled: true })
  })

  it('УСТРОЙСТВО ПОДПИСЫВАЕТСЯ', async () => {
    const response = await request(server())
      .post('/v1/guest/push/subscribe')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ endpoint: ENDPOINT, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } })

    expect(response.status).toBe(201)

    const saved = await prisma.pushSubscription.findUnique({
      where: { endpoint: ENDPOINT },
      select: { guestId: true, goneAt: true },
    })
    expect(saved).toMatchObject({ guestId: withApp.guestId, goneAt: null })
  })

  it('ПОВТОР С ТОГО ЖЕ УСТРОЙСТВА ОБНОВЛЯЕТ, А НЕ ЗАДВАИВАЕТ', async () => {
    await request(server())
      .post('/v1/guest/push/subscribe')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ endpoint: ENDPOINT, keys: { p256dh: 'q'.repeat(40), auth: 'b'.repeat(16) } })
      .expect(201)

    const all = await prisma.pushSubscription.findMany({
      where: { guestId: withApp.guestId },
      select: { p256dh: true },
    })

    expect(all).toHaveLength(1)
    expect(all[0]?.p256dh).toBe('q'.repeat(40))
  })

  it('БЕЗ ТОКЕНА ГОСТЯ ПОДПИСАТЬСЯ НЕЛЬЗЯ', async () => {
    const response = await request(server())
      .post('/v1/guest/push/subscribe')
      .send({ endpoint: `${ENDPOINT}-2`, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } })

    expect(response.status).toBe(401)
  })
})

describe('Уведомления как второй канал рассылки', () => {
  it('ГОСТЬ С ПРИЛОЖЕНИЕМ БОЛЬШЕ НЕ «НЕКУДА СЛАТЬ»', async () => {
    const response = await request(server())
      .post('/v1/admin/broadcasts/preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ audience: {} })

    expect(response.status).toBe(200)
    // Двое найдены, получит один — тот, у кого приложение.
    expect(response.body).toMatchObject({ found: 2, willReceive: 1, unreachable: 1 })
  })

  it('РАССЫЛКА УХОДИТ УВЕДОМЛЕНИЕМ, И КАНАЛ ВИДЕН В АРХИВЕ', async () => {
    const created = await request(server())
      .post('/v1/admin/broadcasts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Проверка канала', text: 'Заходите на кофе' })
      .expect(201)

    const broadcastId = (created.body as { id: string }).id

    await sender.tick()

    const rows = await prisma.broadcastRecipient.findMany({
      where: { broadcastId },
      select: { guestId: true, delivery: true, channel: true },
    })

    const delivered = rows.find((row) => row.guestId === withApp.guestId)
    const skipped = rows.find((row) => row.guestId === alone.guestId)

    expect(delivered).toMatchObject({ delivery: 'SENT', channel: 'PUSH' })
    expect(skipped).toMatchObject({ delivery: 'SKIPPED_NO_CHANNEL' })

    // Заголовок уведомления — имя заведения: гость видит, от кого оно.
    expect(sent.at(-1)).toMatchObject({ guestId: withApp.guestId, body: 'Заходите на кофе' })
  })

  it('ОТПИСКА ВОЗВРАЩАЕТ ГОСТЯ В «НЕКУДА СЛАТЬ»', async () => {
    await request(server())
      .post('/v1/guest/push/unsubscribe')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ endpoint: ENDPOINT })
      .expect(201)

    const response = await request(server())
      .post('/v1/admin/broadcasts/preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ audience: {} })

    expect(response.body).toMatchObject({ willReceive: 0, unreachable: 2 })
  })
})
