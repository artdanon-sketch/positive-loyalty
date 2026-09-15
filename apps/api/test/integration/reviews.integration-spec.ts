import { randomUUID } from 'node:crypto'
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
  createLedgerTestContext,
  createMembershipFixture,
  idempotencyKey,
  POS_ORIGIN,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Отзывы гостей. docs/02, разделы 2.8, 5.12 и 5.6.4 · docs/11, У10.
 *
 * Приёмка из docs/11: гость ставит «2» с комментарием — владелец видит отзыв с кассиром,
 * отвечает, гость видит ответ; автоответ приходит сразу.
 *
 * Полигон: гость заведения с четырьмя чеками — вчерашний чек кассира, чек из кассы
 * вебхуком, чек десятидневной давности и отменённый чек. Соседнее заведение со своим гостем.
 *
 * HTTP-проверки ходят владельцем базы, которого RLS не касается. Поэтому политики `Review`
 * проверены отдельно — подключением под ролью приложения (последний блок).
 */

const SECRET = 'reviews-secret-not-used-anywhere-else'
const AUTO_REPLY = 'Нам очень жаль. Напишите, что случилось, — разберёмся и исправим.'
const THANKS = 'Спасибо! Ждём вас снова.'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let venue: MembershipFixture
let neighbour: MembershipFixture
let cashierId: string
let freshEntry: string
let webhookEntry: string
let oldEntry: string
let voidedEntry: string
let ownerToken: string
let managerToken: string
let cashierToken: string
let neighbourOwnerToken: string
let reviewId: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`
const guestBearer = (guestId: string): string => bearer(signGuestToken({ guestId }, SECRET))

interface ErrorBody {
  error: { code: string }
}

interface ReviewBody {
  id: string
  rating: number
  tags: string[]
  comment: string | null
  reply: string | null
  autoReply?: boolean
}

interface GuestReviewsBody {
  pending: Array<{ ledgerEntryId: string }>
  items: ReviewBody[]
}

interface AdminListBody {
  summary: {
    total: number
    average: number | null
    distribution: number[]
    tags: Array<{ tag: string; count: number }>
    unanswered: number
  }
  total: number
  items: Array<
    ReviewBody & {
      guest: { membershipId: string }
      staff: { id: string; displayName: string } | null
      amount: number | null
    }
  >
}

const postReview = (guestId: string, body: Record<string, unknown>) =>
  request(server()).post('/v1/guest/reviews').set('Authorization', guestBearer(guestId)).send(body)

const guestReviews = (guestId: string) =>
  request(server()).get('/v1/guest/reviews').set('Authorization', guestBearer(guestId))

const adminReviews = (token: string, query = '') =>
  request(server()).get(`/v1/admin/reviews${query}`).set('Authorization', bearer(token))

const receipt = async (
  fixture: MembershipFixture,
  options: { readonly cashier?: string; readonly occurredAt?: Date } = {},
): Promise<string> => {
  const result = await ledger.earn(
    {
      membershipId: fixture.membershipId,
      amount: 2_250,
      basisAmount: 45_000,
      idempotencyKey: idempotencyKey('review-check'),
      refType: 'receipt',
      refId: `rv-${randomUUID().slice(0, 8)}`,
      ...(options.cashier === undefined
        ? POS_ORIGIN
        : {
            source: 'STAFF_MANUAL' as const,
            actorType: 'STAFF' as const,
            actorId: options.cashier,
          }),
      ...(options.occurredAt === undefined ? {} : { occurredAt: options.occurredAt.toISOString() }),
    },
    { tenantId: fixture.tenantId },
  )

  return result.entry.id
}

/**
 * Настоящий PrismaService под ролью приложения: переменная подменяется на время сборки.
 * Приём из ledger-app-role: без строки подключения блок падает с инструкцией, а не пропускается.
 */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      'Не задан DATABASE_URL_TEST_APP_ROLE — без роли positive_app политики Review не проверить.',
    )
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
  ledger = moduleRef.get(LedgerService)

  venue = await createMembershipFixture(prisma)
  neighbour = await createMembershipFixture(prisma)

  await prisma.tenant.update({
    where: { id: venue.tenantId },
    data: { settings: { reviews: { autoReplies: [AUTO_REPLY, AUTO_REPLY, null, null, null] } } },
  })

  cashierId = (
    await prisma.staff.create({
      data: { tenantId: venue.tenantId, displayName: 'Сомчай', role: 'CASHIER' },
      select: { id: true },
    })
  ).id

  oldEntry = await receipt(venue, { occurredAt: new Date(Date.now() - 10 * DAY_MS) })

  voidedEntry = await receipt(venue)
  await ledger.reverse(
    {
      entryId: voidedEntry,
      idempotencyKey: idempotencyKey('review-void'),
      reason: 'RECEIPT_VOIDED',
      ...POS_ORIGIN,
    },
    { tenantId: venue.tenantId },
  )

  webhookEntry = await receipt(venue)
  freshEntry = await receipt(venue, { cashier: cashierId })

  const sign = (tenant: string, role: string): string =>
    signAccessToken({ tenantId: tenant, actorId: null, role }, SECRET)

  ownerToken = sign(venue.tenantId, 'OWNER')
  managerToken = sign(venue.tenantId, 'MANAGER')
  cashierToken = sign(venue.tenantId, 'CASHIER')
  neighbourOwnerToken = sign(neighbour.tenantId, 'OWNER')
})

afterAll(async () => {
  await app.close()
})

describe('Отзывы: гость оценивает визит', () => {
  it('ГОСТЬ СТАВИТ «2» С КОММЕНТАРИЕМ — АВТООТВЕТ ПРИХОДИТ СРАЗУ, КАССИР ЗАПИСАН ИЗ ЖУРНАЛА', async () => {
    const before = await guestReviews(venue.guestId)
    expect(before.status).toBe(200)
    // Один визит на заведение — самый свежий; старый и отменённый чеки оценить нельзя.
    expect((before.body as GuestReviewsBody).pending.map((visit) => visit.ledgerEntryId)).toEqual([
      freshEntry,
    ])

    const created = await postReview(venue.guestId, {
      ledgerEntryId: freshEntry,
      rating: 2,
      tags: ['SERVICE', 'STAFF'],
      comment: 'Ждали заказ сорок минут',
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      rating: 2,
      tags: ['SERVICE', 'STAFF'],
      comment: 'Ждали заказ сорок минут',
      reply: AUTO_REPLY,
    })
    reviewId = (created.body as ReviewBody).id

    const stored = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { tenantId: true, staffId: true, autoReply: true },
    })
    expect(stored).toEqual({ tenantId: venue.tenantId, staffId: cashierId, autoReply: true })

    const after = (await guestReviews(venue.guestId)).body as GuestReviewsBody
    expect(after.pending.map((visit) => visit.ledgerEntryId)).toEqual([webhookEntry])
    expect(after.items[0]).toMatchObject({ id: reviewId, rating: 2, reply: AUTO_REPLY })
  })

  it('ОДИН ОТЗЫВ НА ЧЕК; ЧУЖОЙ, ОТМЕНЁННЫЙ И СТАРЫЙ ЧЕК НЕ ОЦЕНИТЬ', async () => {
    const again = await postReview(venue.guestId, { ledgerEntryId: freshEntry, rating: 5 })
    expect(again.status).toBe(409)
    expect((again.body as ErrorBody).error.code).toBe('REVIEW_EXISTS')

    const foreign = await postReview(neighbour.guestId, { ledgerEntryId: webhookEntry, rating: 1 })
    expect(foreign.status).toBe(404)
    expect((foreign.body as ErrorBody).error.code).toBe('VISIT_NOT_FOUND')

    const voided = await postReview(venue.guestId, { ledgerEntryId: voidedEntry, rating: 1 })
    expect(voided.status).toBe(404)
    expect((voided.body as ErrorBody).error.code).toBe('VISIT_NOT_FOUND')

    const old = await postReview(venue.guestId, { ledgerEntryId: oldEntry, rating: 4 })
    expect(old.status).toBe(409)
    expect((old.body as ErrorBody).error.code).toBe('REVIEW_WINDOW_CLOSED')

    const invalid = await postReview(venue.guestId, { ledgerEntryId: webhookEntry, rating: 6 })
    expect(invalid.status).toBe(400)
    expect((invalid.body as ErrorBody).error.code).toBe('VALIDATION_FAILED')
  })
})

describe('Отзывы: бэк-офис', () => {
  it('ВЛАДЕЛЕЦ ВИДИТ ОТЗЫВ С КАССИРОМ И СВОДКУ; МЕНЕДЖЕР ОТВЕЧАЕТ — ГОСТЬ ВИДИТ ОТВЕТ', async () => {
    const list = await adminReviews(ownerToken, '?period=7d')
    expect(list.status).toBe(200)

    const body = list.body as AdminListBody
    expect(body.summary).toEqual({
      total: 1,
      average: 2,
      distribution: [0, 1, 0, 0, 0],
      tags: [
        { tag: 'SERVICE', count: 1 },
        { tag: 'STAFF', count: 1 },
        { tag: 'QUALITY', count: 0 },
        { tag: 'PRICE', count: 0 },
        { tag: 'ASSORTMENT', count: 0 },
      ],
      // Автоответ — тоже ответ: гость его уже получил.
      unanswered: 0,
    })
    expect(body.items[0]).toMatchObject({
      id: reviewId,
      autoReply: true,
      guest: { membershipId: venue.membershipId },
      staff: { id: cashierId, displayName: 'Сомчай' },
      amount: 45_000,
    })

    expect(((await adminReviews(ownerToken, '?answered=no')).body as AdminListBody).total).toBe(0)
    expect(((await adminReviews(ownerToken, '?rating=5')).body as AdminListBody).total).toBe(0)
    expect((await adminReviews(ownerToken, '?rating=7')).status).toBe(400)

    const text = 'Спасибо, что написали. Разобрались с кухней.'
    const replied = await request(server())
      .post(`/v1/admin/reviews/${reviewId}/reply`)
      .set('Authorization', bearer(managerToken))
      .send({ text })
    expect(replied.status).toBe(200)
    expect(replied.body).toMatchObject({ id: reviewId, reply: text, autoReply: false })

    const empty = await request(server())
      .post(`/v1/admin/reviews/${reviewId}/reply`)
      .set('Authorization', bearer(managerToken))
      .send({ text: '   ' })
    expect(empty.status).toBe(400)

    const guest = (await guestReviews(venue.guestId)).body as GuestReviewsBody
    expect(guest.items[0]).toMatchObject({ id: reviewId, reply: text })
  })

  it('ЧУЖОЕ ЗАВЕДЕНИЕ ОТЗЫВА НЕ ВИДИТ И НЕ ОТВЕТИТ; КАССИРУ ОТЗЫВЫ ЗАКРЫТЫ', async () => {
    const foreign = (await adminReviews(neighbourOwnerToken)).body as AdminListBody
    expect(foreign.items.map((item) => item.id)).not.toContain(reviewId)
    expect(foreign.summary.total).toBe(0)

    const foreignReply = await request(server())
      .post(`/v1/admin/reviews/${reviewId}/reply`)
      .set('Authorization', bearer(neighbourOwnerToken))
      .send({ text: 'Чужой ответ' })
    expect(foreignReply.status).toBe(404)

    expect((await adminReviews(cashierToken)).status).toBe(403)
  })

  it('АВТООТВЕТЫ НАСТРАИВАЕТ ВЛАДЕЛЕЦ — НОВЫЙ ОТЗЫВ НА «5» ПОЛУЧАЕТ СВОЙ ОТВЕТ', async () => {
    const path = '/v1/admin/settings/program/reviews'
    const autoReplies = [null, null, null, null, THANKS]

    const saved = await request(server())
      .put(path)
      .set('Authorization', bearer(ownerToken))
      .send({ autoReplies })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ autoReplies })

    const read = await request(server()).get(path).set('Authorization', bearer(ownerToken))
    expect(read.body).toEqual({ autoReplies })

    const manager = await request(server())
      .put(path)
      .set('Authorization', bearer(managerToken))
      .send({ autoReplies })
    expect(manager.status).toBe(403)

    const short = await request(server())
      .put(path)
      .set('Authorization', bearer(ownerToken))
      .send({ autoReplies: [null, null, null, null] })
    expect(short.status).toBe(400)

    const five = await postReview(venue.guestId, { ledgerEntryId: webhookEntry, rating: 5 })
    expect(five.status).toBe(201)
    expect(five.body).toMatchObject({ rating: 5, reply: THANKS })

    // Чек из кассы вебхуком — без сотрудника.
    const stored = await prisma.review.findUniqueOrThrow({
      where: { ledgerEntryId: webhookEntry },
      select: { staffId: true },
    })
    expect(stored.staffId).toBeNull()
  })
})

describe('Отзывы: политики RLS под ролью приложения', () => {
  let appRole: LedgerTestContext

  beforeAll(async () => {
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('СОЕДИНЕНИЕ ПОДЧИНЯЕТСЯ ПОЛИТИКАМ: БЕЗ ОБЪЯВЛЕННОГО ГОСТЯ И ЗАВЕДЕНИЯ ОТЗЫВА НЕ ВИДНО', async () => {
    expect(await appRole.prisma.review.findMany({ where: { id: reviewId } })).toEqual([])
  })

  it('ОТЗЫВ ВИДЯТ ЕГО ГОСТЬ И ЕГО ЗАВЕДЕНИЕ, СОСЕДИ — НЕТ', async () => {
    const find = { where: { id: reviewId }, select: { id: true } } as const

    expect(
      await appRole.prisma.forGuest(venue.guestId, async (tx) => tx.review.findMany(find)),
    ).toEqual([{ id: reviewId }])
    expect(
      await appRole.prisma.forTenant(venue.tenantId, async (tx) => tx.review.findMany(find)),
    ).toEqual([{ id: reviewId }])
    expect(
      await appRole.prisma.forGuest(neighbour.guestId, async (tx) => tx.review.findMany(find)),
    ).toEqual([])
    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) => tx.review.findMany(find)),
    ).toEqual([])
  })

  it('ГОСТЬ ПИШЕТ ОТЗЫВ ТОЛЬКО О СВОЁМ ЧЕКЕ И В ЗАВЕДЕНИЕ ЭТОГО ЧЕКА', async () => {
    const ownCheck = await receipt(venue)
    const secondOwnCheck = await receipt(venue)
    const neighbourCheck = await receipt(neighbour)

    const created = await appRole.prisma.forGuest(venue.guestId, async (tx) =>
      tx.review.create({
        data: {
          tenantId: venue.tenantId,
          guestId: venue.guestId,
          ledgerEntryId: ownCheck,
          rating: 4,
        },
        select: { id: true },
      }),
    )
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

    // Чужой чек под своим именем.
    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.review.create({
          data: {
            tenantId: neighbour.tenantId,
            guestId: venue.guestId,
            ledgerEntryId: neighbourCheck,
            rating: 1,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)

    // Свой чек, но отзыв — в чужое заведение.
    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.review.create({
          data: {
            tenantId: neighbour.tenantId,
            guestId: venue.guestId,
            ledgerEntryId: secondOwnCheck,
            rating: 1,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)

    // Отзыв от имени другого гостя.
    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.review.create({
          data: {
            tenantId: neighbour.tenantId,
            guestId: neighbour.guestId,
            ledgerEntryId: neighbourCheck,
            rating: 1,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('ГОСТЬ НЕ ПЕРЕПИШЕТ ОЦЕНКУ И ОТВЕТ; ЗАВЕДЕНИЕ ОТВЕЧАЕТ', async () => {
    const byGuest = await appRole.prisma.forGuest(venue.guestId, async (tx) =>
      tx.review.updateMany({ where: { id: reviewId }, data: { rating: 5, reply: 'Сам себе' } }),
    )
    expect(byGuest.count).toBe(0)

    const byVenue = await appRole.prisma.forTenant(venue.tenantId, async (tx) =>
      tx.review.updateMany({ where: { id: reviewId }, data: { reply: 'Спасибо за отзыв' } }),
    )
    expect(byVenue.count).toBe(1)
  })
})
