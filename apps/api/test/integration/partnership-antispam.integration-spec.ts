import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createLedgerTestContext,
  createTenant,
  type LedgerTestContext,
} from './ledger-test-context'

/**
 * Антиспам приглашений. docs/07, раздел 6.2 · docs/02, раздел 5.8.
 *
 * Три отказа от разных получателей за неделю — одно приглашение в день на месяц.
 * Пять жалоб «спам» — приглашать нельзя, пока платформа не разберёт.
 * Кто пожаловался, обвинённый не узнаёт.
 *
 * Приглашения заводятся прямо в базе: так отказы не упираются в квоту
 * отправителя, а квота и приглашение проверены в partnerships-negotiation.
 *
 * ВИДИМОСТЬ И ПРАВА ПРОВЕРЯЮТСЯ РОЛЬЮ ПРИЛОЖЕНИЯ. Тесты ходят владельцем таблиц,
 * а владельца политики не касаются: проверка «обвинённый не видит жалобу»
 * под ним была бы зелёной при любой политике.
 */

const SECRET = 'partnership-antispam-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000
const PITCH = 'Мы студия танцев через дорогу, у нас двести учеников в месяц. Давайте дружить.'

interface Venue {
  id: string
  owner: string
  manager: string
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

interface QuotaBody {
  freeLimit: number
  freeUsed: number
  freeLeft: number
  restriction: { kind: string; until?: string } | null
}

let app: INestApplication
let prisma: PrismaService
/** positive_app: под этой ролью API работает в бою, и под ней действуют политики. */
let appRole: LedgerTestContext

/**
 * Строка подключения под ролью positive_app. Приём из tenant-isolation и
 * ledger-app-role, включая отказ вместо пропуска: пропущенная проверка
 * изоляции выглядит как отсутствие проблемы.
 */
const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_APP_ROLE — строка подключения под ролью positive_app. ' +
      'Без неё RLS не проверяется: тесты ходят владельцем, а владельца политики не касаются. ' +
      'Как завести роль локально — в prisma/README.md.',
  )
}

/** Настоящий PrismaService под ролью приложения: переменная подменяется на время сборки. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = appRoleUrl()

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

const server = (): Server => app.getHttpServer() as Server

const sign = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET)

const venue = async (): Promise<Venue> => {
  const id = await createTenant(prisma)
  return { id, owner: sign(id, 'OWNER'), manager: sign(id, 'MANAGER') }
}

const venues = (count: number): Promise<Venue[]> =>
  Promise.all(Array.from({ length: count }, () => venue()))

const pair = async (): Promise<[Venue, Venue]> => {
  const [first, second] = await venues(2)

  if (first === undefined || second === undefined) {
    throw new Error('полигон не собрался')
  }

  return [first, second]
}

/** Приглашение от `from` к `to`, ждущее ответа. */
const proposed = async (from: Venue, to: Venue): Promise<string> => {
  const row = await prisma.partnership.create({
    data: { initiatorTenantId: from.id, partnerTenantId: to.id, status: 'PROPOSED' },
    select: { id: true },
  })

  return row.id
}

const act = (token: string, id: string, action: string, body: object = {}) =>
  request(server())
    .post(`/v1/admin/partnerships/${id}/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)

const invite = (token: string, partnerTenantId: string) =>
  request(server())
    .post('/v1/admin/partnerships/invites')
    .set('Authorization', `Bearer ${token}`)
    .send({ partnerTenantId, text: PITCH })

const quota = async (token: string): Promise<QuotaBody> =>
  (
    await request(server())
      .get('/v1/admin/partnerships/quota')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  ).body as QuotaBody

const code = (response: { body: unknown }): string => (response.body as ErrorBody).error.code

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  appRole = await createAppRoleContext()
}, 60_000)

afterAll(async () => {
  // beforeAll мог упасть раньше, чем поднялся второй контекст: настоящую причину
  // не должен перекрывать TypeError из teardown.
  await appRole?.close()
  await app?.close()
})

describe('Автоохлаждение', () => {
  it('ТРИ ОТКАЗА ОТ РАЗНЫХ ЗАВЕДЕНИЙ ЗА НЕДЕЛЮ — ОДНО ПРИГЛАШЕНИЕ В ДЕНЬ НА МЕСЯЦ', async () => {
    const spammer = await venue()
    const [first, second, third, fourth, fifth] = await venues(5)

    if (!first || !second || !third || !fourth || !fifth) {
      throw new Error('полигон не собрался')
    }

    await act(first.owner, await proposed(spammer, first), 'decline').expect(200)
    await act(second.owner, await proposed(spammer, second), 'decline').expect(200)

    // Два отказа — ещё не охлаждение.
    expect((await quota(spammer.owner)).restriction).toBeNull()

    // Третий — блокировкой входящего приглашения: это тоже отказ.
    await act(third.owner, await proposed(spammer, third), 'block').expect(200)

    const cooled = await quota(spammer.owner)
    expect(cooled).toMatchObject({
      freeLimit: 1,
      freeUsed: 0,
      freeLeft: 1,
      restriction: { kind: 'COOLING' },
    })

    const left = new Date(cooled.restriction?.until ?? 0).getTime() - Date.now()
    expect(left).toBeGreaterThan(29 * DAY_MS)
    expect(left).toBeLessThanOrEqual(30 * DAY_MS)

    await invite(spammer.owner, fourth.id).expect(201)

    const over = await invite(spammer.owner, fifth.id).expect(402)
    expect(code(over)).toBe('INVITE_QUOTA_EXCEEDED')
    expect((over.body as ErrorBody).error.details).toMatchObject({
      freeLeft: 0,
      coolingUntil: cooled.restriction?.until,
    })
  })

  it('блокировка уже идущего разговора — не отказ приглашению', async () => {
    const [studio, restaurant] = await pair()

    const id = await proposed(studio, restaurant)
    await act(restaurant.owner, id, 'accept').expect(200)
    await act(restaurant.owner, id, 'block').expect(200)

    expect(await prisma.inviteStrike.count({ where: { partnershipId: id } })).toBe(0)
  })
})

describe('Жалоба «спам»', () => {
  it('ЖАЛОБА — ЭТО БЛОКИРОВКА, ОТКАЗ И СЛЕД ДЛЯ ПЛАТФОРМЫ', async () => {
    const [spammer, victim] = await pair()
    const id = await proposed(spammer, victim)

    const reported = await act(victim.owner, id, 'block', {
      spam: true,
      reason: 'Рассылка всем подряд',
    }).expect(200)
    expect((reported.body as { status: string }).status).toBe('DECLINED')

    expect(code(await invite(spammer.owner, victim.id).expect(403))).toBe('BLOCKED_BY_RECIPIENT')

    const trail = await prisma.auditLog.findFirst({
      where: { action: 'INVITE_SPAM_REPORTED', tenantId: victim.id, entityId: spammer.id },
      select: { actorType: true, reason: true, newValue: true },
    })
    expect(trail).toMatchObject({
      actorType: 'OWNER',
      reason: 'Рассылка всем подряд',
      newValue: { partnershipId: id },
    })
  })

  it('ОБВИНЁННЫЙ НЕ ВИДИТ ЖАЛОБУ, НЕ ПИШЕТ СЛЕДЫ ЗА ДРУГИХ И НЕ РАЗБИРАЕТ ЖАЛОБЫ НА СЕБЯ', async () => {
    const [spammer, victim] = await pair()
    const id = await proposed(spammer, victim)

    await act(victim.owner, id, 'block', { spam: true }).expect(200)

    // Пожаловавшийся видит оба своих следа, обвинённый — только отказ.
    const mine = await appRole.prisma.forTenant(victim.id, (tx) =>
      tx.inviteStrike.findMany({ where: { partnershipId: id }, select: { kind: true } }),
    )
    expect(mine.map((row) => row.kind).sort()).toEqual(['DECLINED', 'SPAM'])

    const theirs = await appRole.prisma.forTenant(spammer.id, (tx) =>
      tx.inviteStrike.findMany({ where: { partnershipId: id }, select: { kind: true } }),
    )
    expect(theirs).toEqual([{ kind: 'DECLINED' }])

    // След пишется только от своего имени: наклеветать «от соседа» нельзя.
    await expect(
      appRole.prisma.forTenant(spammer.id, (tx) =>
        tx.inviteStrike.createMany({
          data: [
            {
              kind: 'SPAM',
              fromTenantId: victim.id,
              againstTenantId: victim.id,
              partnershipId: id,
            },
          ],
        }),
      ),
    ).rejects.toThrow()

    // Отметку «разобрано» ставит платформа, а не заведение.
    await expect(
      appRole.prisma.forTenant(spammer.id, (tx) =>
        tx.inviteStrike.updateMany({
          where: { againstTenantId: spammer.id },
          data: { reviewedAt: new Date() },
        }),
      ),
    ).rejects.toThrow()

    expect(
      await prisma.inviteStrike.count({
        where: { partnershipId: id, kind: 'SPAM', reviewedAt: null },
      }),
    ).toBe(1)
  })

  it('ПЯТЬ ЖАЛОБ ОТ РАЗНЫХ ЗАВЕДЕНИЙ — ПРИГЛАШЕНИЯ ПРИОСТАНОВЛЕНЫ ДО РАЗБОРА', async () => {
    const spammer = await venue()
    const victims = await venues(5)
    const stranger = await venue()

    for (const [index, victim] of victims.entries()) {
      await act(victim.owner, await proposed(spammer, victim), 'block', { spam: true }).expect(200)

      if (index === 3) {
        // Четыре жалобы — это уже охлаждение (они же отказы), но не приостановка.
        expect((await quota(spammer.owner)).restriction).toMatchObject({ kind: 'COOLING' })
      }
    }

    expect(await quota(spammer.owner)).toMatchObject({
      freeLimit: 0,
      freeLeft: 0,
      restriction: { kind: 'SUSPENDED' },
    })
    expect(code(await invite(spammer.owner, stranger.id).expect(403))).toBe('INVITES_SUSPENDED')

    // Платформа разобрала жалобы: приостановка снята, охлаждение за отказы осталось.
    await prisma.inviteStrike.updateMany({
      where: { againstTenantId: spammer.id, kind: 'SPAM' },
      data: { reviewedAt: new Date() },
    })
    expect((await quota(spammer.owner)).restriction).toMatchObject({ kind: 'COOLING' })
  })

  it('пожаловаться можно только на приглашение, которое ждёт вашего ответа', async () => {
    const [studio, restaurant] = await pair()
    const id = await proposed(studio, restaurant)

    // Своё приглашение спамом не бывает.
    expect(code(await act(studio.owner, id, 'block', { spam: true }).expect(409))).toBe(
      'PARTNERSHIP_STATE',
    )
    // Менеджер не блокирует и не жалуется.
    await act(restaurant.manager, id, 'block', { spam: true }).expect(403)
    // Флаг — только флагом.
    await act(restaurant.owner, id, 'block', { spam: 'yes' }).expect(400)

    expect(await prisma.inviteStrike.count({ where: { partnershipId: id } })).toBe(0)
    const still = await prisma.partnership.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    })
    expect(still.status).toBe('PROPOSED')
  })
})
