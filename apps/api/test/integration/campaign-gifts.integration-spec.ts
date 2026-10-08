import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppModule } from '../../src/app.module'
import { AutomationRunService } from '../../src/admin/automation-run.service'
import { giftKey } from '../../src/admin/broadcast-gift.service'
import { BroadcastSendService } from '../../src/admin/broadcast-send.service'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { TelegramBotService } from '../../src/identity/telegram-bot.service'

import {
  countByIdempotencyKey,
  createMembershipFixture,
  readBalance,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Подарки в рассылках и автосценариях. docs/02, разделы 5.4 и 5.4.1.
 *
 * Полигон: заведение с тремя гостями — с Telegram, без единого канала и гостем
 * контрольной группы. По соседству — заведение со своим сертификатом.
 *
 * Главное, что проверяется:
 *   • подарок получает каждый из аудитории — и тот, до кого сообщение не дошло;
 *   • контрольная группа подарков не получает, как и подарка ко дню рождения;
 *   • повторный проход не дарит второй раз;
 *   • сценарий дарит один раз за эпизод, а «ждут» показывает цену до включения.
 */

const SECRET = 'campaign-gifts-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000
const POINTS = 10_000

let app: INestApplication
let prisma: PrismaService
let sender: BroadcastSendService
let runner: AutomationRunService

let reachable: MembershipFixture
let unreachable: MembershipFixture
let control: MembershipFixture
let ownerToken: string
let neighbourOwnerToken: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`

interface BroadcastBody {
  id: string
  status: string
  total: number
  gift: unknown
  gifted: number
}

interface ErrorBody {
  error: { code: string }
}

interface RuleBody {
  kind: string
  enabled: boolean
  gift: unknown
  waiting: number
}

const createBroadcast = (token: string, body: Record<string, unknown>) =>
  request(server()).post('/v1/admin/broadcasts').set('Authorization', bearer(token)).send(body)

const broadcastOf = async (token: string, id: string): Promise<BroadcastBody | undefined> => {
  const response = await request(server())
    .get('/v1/admin/broadcasts?limit=100')
    .set('Authorization', bearer(token))

  return (response.body as { items: BroadcastBody[] }).items.find((item) => item.id === id)
}

/** Проходы разгребателя, пока рассылка не закроется: он берёт за раз несколько рассылок. */
const sendUntilDone = async (token: string, id: string, now?: Date): Promise<BroadcastBody> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sender.tick(now)
    const body = await broadcastOf(token, id)

    if (body?.status === 'SENT') {
      return body
    }
  }

  throw new Error(`Рассылка ${id} не закрылась за десять проходов`)
}

const createCertificate = async (token: string, title: string): Promise<string> => {
  const response = await request(server())
    .post('/v1/admin/certificates')
    .set('Authorization', bearer(token))
    .send({ title, value: { kind: 'FIXED_OFF', amount: 50_000 }, validityDays: 30 })

  expect(response.status).toBe(201)
  return (response.body as { id: string }).id
}

const pauseCertificate = async (token: string, id: string): Promise<void> => {
  await request(server())
    .patch(`/v1/admin/certificates/${id}`)
    .set('Authorization', bearer(token))
    .send({ isActive: false })
    .expect(200)
}

const grantsFor = async (broadcastId: string, guestIds: string[]): Promise<number> =>
  prisma.offerGrant.count({
    where: { nonce: { in: guestIds.map((guestId) => giftKey(broadcastId, guestId)) } },
  })

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const telegramStub = {
    enabled: true,
    api: {
      sendMessage: vi.fn(async () => {
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
  runner = moduleRef.get(AutomationRunService)

  reachable = await createMembershipFixture(prisma)
  unreachable = await createMembershipFixture(prisma, { tenantId: reachable.tenantId })
  control = await createMembershipFixture(prisma, { tenantId: reachable.tenantId })
  const neighbour = await createMembershipFixture(prisma)

  const stamp = String(Date.now()).slice(-8)
  for (const [guestId, prefix] of [
    [reachable.guestId, '41'],
    [control.guestId, '42'],
  ] as const) {
    await prisma.guestIdentity.create({
      data: { guestId, provider: 'TELEGRAM', externalId: `${prefix}${stamp}` },
    })
  }

  await prisma.membership.update({
    where: { id: control.membershipId },
    data: { isControlGroup: true },
  })

  ownerToken = signAccessToken(
    { tenantId: reachable.tenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
  neighbourOwnerToken = signAccessToken(
    { tenantId: neighbour.tenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
})

afterAll(async () => {
  await app.close()
})

describe('Рассылка с подарком', () => {
  let pointsBroadcast: string

  it('БАЛЛЫ ПОЛУЧАЮТ ВСЕ ИЗ АУДИТОРИИ — И ТОТ, КОМУ СООБЩЕНИЕ НЕ ДОШЛО; КОНТРОЛЬНАЯ ГРУППА — НЕТ', async () => {
    const created = await createBroadcast(ownerToken, {
      title: 'Подарок всем',
      text: 'Дарим сто батов баллами!',
      gift: { kind: 'POINTS', amount: POINTS },
    })

    expect(created.status).toBe(201)
    const body = created.body as BroadcastBody
    expect(body).toMatchObject({ gift: { kind: 'POINTS', amount: POINTS }, gifted: 0, total: 3 })
    pointsBroadcast = body.id

    const done = await sendUntilDone(ownerToken, pointsBroadcast)

    // Двое получили, контрольная группа — нет, хотя сообщение ей ушло.
    expect(done.gifted).toBe(2)
    expect(await readBalance(prisma, reachable.membershipId)).toBe(POINTS)
    expect(await readBalance(prisma, unreachable.membershipId)).toBe(POINTS)
    expect(await readBalance(prisma, control.membershipId)).toBe(0)
  })

  it('ПОВТОРНЫЙ ПРОХОД ВТОРОЙ РАЗ НЕ ДАРИТ', async () => {
    await sender.tick()
    await sender.tick()

    expect(await readBalance(prisma, reachable.membershipId)).toBe(POINTS)
    expect(await countByIdempotencyKey(prisma, giftKey(pointsBroadcast, reachable.guestId))).toBe(1)
  })

  it('СЕРТИФИКАТ В ПОДАРОК: ПРОМОКОД ЛОЖИТСЯ В КОШЕЛЁК, КОНТРОЛЬНОЙ ГРУППЕ — НЕТ', async () => {
    const certificate = await createCertificate(ownerToken, 'Десерт в подарок')

    const created = await createBroadcast(ownerToken, {
      title: 'Десерт всем',
      text: 'Десерт за наш счёт',
      gift: { kind: 'CERTIFICATE', certificateId: certificate },
    })
    expect(created.status).toBe(201)
    const id = (created.body as BroadcastBody).id

    const done = await sendUntilDone(ownerToken, id)

    expect(done.gifted).toBe(2)
    expect(await grantsFor(id, [reachable.guestId, unreachable.guestId])).toBe(2)
    expect(await grantsFor(id, [control.guestId])).toBe(0)
  })

  it('ЧУЖОЙ ИЛИ ВЫКЛЮЧЕННЫЙ СЕРТИФИКАТ — ОТКАЗ СРАЗУ, А НЕ ГОСТИ БЕЗ ПОДАРКА', async () => {
    const foreign = await createCertificate(neighbourOwnerToken, 'Соседский сертификат')
    const paused = await createCertificate(ownerToken, 'Летний, выключен')
    await pauseCertificate(ownerToken, paused)

    for (const certificateId of [foreign, paused]) {
      const response = await createBroadcast(ownerToken, {
        title: 'Не уйдёт',
        text: 'Этот подарок выдать нельзя',
        gift: { kind: 'CERTIFICATE', certificateId },
      })

      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('CERTIFICATE_NOT_FOUND')
    }
  })

  it('ШАБЛОН ВЫКЛЮЧИЛИ ПОСЛЕ СОЗДАНИЯ — РАССЫЛКА ЗАКРЫВАЕТСЯ, И ВИДНО, ЧТО ПОДАРКОВ НЕ БЫЛО', async () => {
    const certificate = await createCertificate(ownerToken, 'Осенний, выключат')
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000)

    const created = await createBroadcast(ownerToken, {
      title: 'Вечером',
      text: 'Вечерний подарок',
      sendAt: later.toISOString(),
      gift: { kind: 'CERTIFICATE', certificateId: certificate },
    })
    expect(created.status).toBe(201)
    const id = (created.body as BroadcastBody).id

    await pauseCertificate(ownerToken, certificate)

    const done = await sendUntilDone(ownerToken, id, new Date(later.getTime() + 60_000))

    expect(done.gifted).toBe(0)
    expect(await grantsFor(id, [reachable.guestId, unreachable.guestId])).toBe(0)
  })
})

describe('Автосценарий с подарком', () => {
  let sleeper: MembershipFixture
  let token: string

  beforeAll(async () => {
    sleeper = await createMembershipFixture(prisma)
    await prisma.membership.update({
      where: { id: sleeper.membershipId },
      data: { lastVisitAt: new Date(Date.now() - 60 * DAY_MS) },
    })
    token = signAccessToken({ tenantId: sleeper.tenantId, actorId: null, role: 'OWNER' }, SECRET)
  })

  const sleeping = async (): Promise<RuleBody> => {
    const response = await request(server())
      .get('/v1/admin/automation')
      .set('Authorization', bearer(token))
      .expect(200)

    const rule = (response.body as { items: RuleBody[] }).items.find(
      (item) => item.kind === 'SLEEPING',
    )
    if (rule === undefined) {
      throw new Error('нет сценария «давно не заходили»')
    }
    return rule
  }

  const broadcastsOfVenue = async () =>
    prisma.broadcast.findMany({ where: { tenantId: sleeper.tenantId }, select: { id: true } })

  /** Проходы сценариев, пока наш не сработает: разгребатель берёт по нескольку заведений. */
  const runUntilStarted = async (now?: Date): Promise<void> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runner.tick(now)
      if ((await broadcastsOfVenue()).length > 0) {
        return
      }
    }
  }

  it('«ЖДУТ» ВИДНО ДО ВКЛЮЧЕНИЯ: ВЛАДЕЛЕЦ ЗНАЕТ ЦЕНУ ПОДАРКА ЗАРАНЕЕ', async () => {
    expect(await sleeping()).toMatchObject({ enabled: false, waiting: 1, gift: null })

    const response = await request(server())
      .put('/v1/admin/automation/SLEEPING')
      .set('Authorization', bearer(token))
      .send({
        enabled: true,
        threshold: 30,
        text: 'Соскучились! Дарим баллы.',
        gift: { kind: 'POINTS', amount: 5_000 },
      })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ gift: { kind: 'POINTS', amount: 5_000 }, waiting: 1 })
  })

  it('СЦЕНАРИЙ ДАРИТ ОДИН РАЗ, А ПОСЛЕ СРАБАТЫВАНИЯ НИКТО НЕ ЖДЁТ', async () => {
    await runUntilStarted()

    const [broadcast] = await broadcastsOfVenue()
    expect(broadcast).toBeDefined()

    await sendUntilDone(token, broadcast?.id ?? '')

    expect(await readBalance(prisma, sleeper.membershipId)).toBe(5_000)
    expect((await sleeping()).waiting).toBe(0)
  })

  it('НАЗАВТРА ТОТ ЖЕ СПЯЩИЙ ВТОРОГО ПОДАРКА НЕ ПОЛУЧАЕТ', async () => {
    await runner.tick(new Date(Date.now() + DAY_MS + 60_000))

    expect(await broadcastsOfVenue()).toHaveLength(1)
    expect(await readBalance(prisma, sleeper.membershipId)).toBe(5_000)
  })

  it('ПОДАРОК СНИМАЕТСЯ ЯВНО, А СТАРЫЙ ЭКРАН БЕЗ КЛЮЧА ЕГО НЕ СБРАСЫВАЕТ', async () => {
    // Старый экран не знает о подарке и не присылает ключ — подарок остаётся.
    await request(server())
      .put('/v1/admin/automation/SLEEPING')
      .set('Authorization', bearer(token))
      .send({ enabled: true, threshold: 30, text: 'Соскучились!' })
      .expect(200)
    expect((await sleeping()).gift).toEqual({ kind: 'POINTS', amount: 5_000 })

    await request(server())
      .put('/v1/admin/automation/SLEEPING')
      .set('Authorization', bearer(token))
      .send({ enabled: true, threshold: 30, text: 'Соскучились!', gift: null })
      .expect(200)
    expect((await sleeping()).gift).toBeNull()
  })
})
