import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  createTenant,
  idempotencyKey,
  type MembershipFixture,
  POS_ORIGIN,
} from './ledger-test-context'

/**
 * Список акций заведения. docs/02, раздел 5.3 · docs/10, раздел 5.3.
 *
 * Полигон: у ресторана партнёрская акция студии (идёт), своя завершённая,
 * запланированная и подарок из карточки гостя. У партнёрской четыре промокода:
 * один выдан, три погашены. Один из погасивших пришёл снова через два дня —
 * он вернулся. Второй «пришёл» через десять минут после погашения — это тот же
 * визит. Третьему повторный чек отменили — визита не было. Вернулся только первый.
 */

const SECRET = 'admin-offers-secret-not-used-anywhere-else'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

let app: INestApplication
let prisma: PrismaService

let restaurantId: string
let studioName: string
let partnershipId: string
let partnerOfferId: string
let endedOfferId: string
let scheduledOfferId: string
let goodwillOfferId: string
let managerToken: string
let ledgerService: LedgerService

interface OfferBody {
  id: string
  status: string
  title: string | null
  howTo: string[]
  partner: { partnershipId: string; name: string | null } | null
  issued: number
  redeemed: number
  returned: number
  actions: { publish: boolean; pause: boolean; end: boolean }
}

const server = (): Server => app.getHttpServer() as Server

const list = async (token: string, query = ''): Promise<OfferBody[]> =>
  (
    (
      await request(server())
        .get(`/v1/admin/offers${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { items: OfferBody[] }
  ).items

const createOffer = async (
  tenantId: string,
  data: {
    type: 'NETWORK_VOUCHER' | 'PROMO_ON_CHECK' | 'GOODWILL'
    status: 'LIVE' | 'SCHEDULED' | 'ENDED'
    title: string
    howTo?: string[]
  },
): Promise<string> => {
  const offer = await prisma.offer.create({
    data: {
      tenantId,
      type: data.type,
      status: data.status,
      visibility: data.type === 'NETWORK_VOUCHER' ? 'PARTNER' : 'VENUE_ONLY',
      audience: {},
      schedule: {},
      limits: {},
      reward: {},
      i18n: { title: { ru: data.title }, howTo: { ru: data.howTo ?? [] } },
    },
    select: { id: true },
  })

  return offer.id
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
  ledgerService = ledger

  restaurantId = await createTenant(prisma)
  const studioId = await createTenant(prisma)
  studioName = `Студия ${studioId.slice(0, 6)}`
  await prisma.tenant.update({ where: { id: studioId }, data: { brandName: studioName } })

  const partnership = await prisma.partnership.create({
    data: {
      initiatorTenantId: studioId,
      partnerTenantId: restaurantId,
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
    select: { id: true },
  })
  partnershipId = partnership.id

  partnerOfferId = await createOffer(restaurantId, {
    type: 'NETWORK_VOUCHER',
    status: 'LIVE',
    title: 'Ролл Филадельфия в подарок',
    howTo: ['Покажите код на кассе', 'К заказу от 800 ฿'],
  })

  await prisma.partnershipTerm.create({
    data: {
      partnershipId,
      triggerTenantId: studioId,
      rewardTenantId: restaurantId,
      offerId: partnerOfferId,
      trigger: { type: 'ON_PURCHASE', minAmount: 0 },
      reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
      limits: {},
      status: 'ACTIVE',
      proposedBy: restaurantId,
    },
  })

  endedOfferId = await createOffer(restaurantId, {
    type: 'PROMO_ON_CHECK',
    status: 'ENDED',
    title: 'Вернём 200 ฿',
  })
  scheduledOfferId = await createOffer(restaurantId, {
    type: 'PROMO_ON_CHECK',
    status: 'SCHEDULED',
    title: 'Тихие часы',
  })
  goodwillOfferId = await createOffer(restaurantId, {
    type: 'GOODWILL',
    status: 'LIVE',
    title: 'Десерт',
  })

  const grant = async (
    guestId: string,
    state: 'ISSUED' | 'REDEEMED',
    redeemedAt: Date | null,
    receiptId: string | null,
  ): Promise<void> => {
    const code = `OFF${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
    await prisma.offerGrant.create({
      data: {
        offerId: partnerOfferId,
        tenantId: restaurantId,
        guestId,
        code,
        nonce: `nonce-${code}`,
        state,
        redeemedAt,
        redeemedReceiptId: receiptId,
        expiresAt: new Date(Date.now() + 14 * DAY_MS),
      },
    })
  }

  const waiting = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const returning = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const sameVisit = await createMembershipFixture(prisma, { tenantId: restaurantId })
  const cancelled = await createMembershipFixture(prisma, { tenantId: restaurantId })

  await grant(waiting.guestId, 'ISSUED', null, null)
  await grant(returning.guestId, 'REDEEMED', new Date(Date.now() - 2 * DAY_MS), 'R-first')
  await grant(sameVisit.guestId, 'REDEEMED', new Date(Date.now() - 10 * 60 * 1000), 'R-same')
  await grant(cancelled.guestId, 'REDEEMED', new Date(Date.now() - 3 * DAY_MS), 'R-cancelled')

  // Вернувшийся: новый чек через два дня после погашения.
  await ledger.earn(
    {
      membershipId: returning.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-returned'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    returning.scope,
  )

  // Не вернувшийся: чек через десять минут после погашения — тот же визит.
  await ledger.earn(
    {
      membershipId: sameVisit.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-same-visit'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    sameVisit.scope,
  )

  // Не вернувшийся: повторный чек отменили — визита не было.
  const cancelledVisit = await ledger.earn(
    {
      membershipId: cancelled.membershipId,
      amount: 5_000,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('offers-cancelled-visit'),
      refType: 'receipt',
      refId: `R-${randomUUID().slice(0, 8)}`,
      ...POS_ORIGIN,
    },
    cancelled.scope,
  )
  await ledger.reverse(
    {
      entryId: cancelledVisit.entry.id,
      idempotencyKey: idempotencyKey('offers-cancelled-reverse'),
      reason: 'WRONG_AMOUNT',
      ...POS_ORIGIN,
    },
    cancelled.scope,
  )

  managerToken = signAccessToken({ tenantId: restaurantId, actorId: null, role: 'MANAGER' }, SECRET)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Список акций', () => {
  it('ПАРТНЁРСКАЯ АКЦИЯ — С ПОМЕТКОЙ ПАРТНЁРА; ПОДАРКИ ИЗ КАРТОЧКИ ГОСТЯ В СПИСКЕ НЕ ЖИВУТ', async () => {
    const items = await list(managerToken)
    const ids = items.map((item) => item.id)

    expect(ids).toEqual([partnerOfferId, scheduledOfferId, endedOfferId])
    expect(ids).not.toContain(goodwillOfferId)

    expect(items[0]).toMatchObject({
      status: 'LIVE',
      title: 'Ролл Филадельфия в подарок',
      howTo: ['Покажите код на кассе', 'К заказу от 800 ฿'],
      partner: { partnershipId, name: studioName },
    })
    expect(items.find((item) => item.id === endedOfferId)?.partner).toBeNull()
  })

  it('ВЫДАНО, ИСПОЛЬЗОВАНО, ВЕРНУЛОСЬ — ВЕРНУВШИМСЯ СЧИТАЕТСЯ ТОЛЬКО ПРИШЕДШИЙ СНОВА С НЕОТМЕНЁННЫМ ЧЕКОМ', async () => {
    const partner = (await list(managerToken)).find((item) => item.id === partnerOfferId)

    expect(partner).toMatchObject({ issued: 4, redeemed: 3, returned: 1 })
  })

  it('фильтры: идут и завершённые', async () => {
    expect((await list(managerToken, '?filter=LIVE')).map((item) => item.id)).toEqual([
      partnerOfferId,
    ])
    expect((await list(managerToken, '?filter=ENDED')).map((item) => item.id)).toEqual([
      endedOfferId,
    ])
  })

  it('чужие акции не видны; кассиру — 403; неизвестный фильтр — 400', async () => {
    const neighbour = await createTenant(prisma)
    const neighbourToken = signAccessToken(
      { tenantId: neighbour, actorId: null, role: 'OWNER' },
      SECRET,
    )

    expect(await list(neighbourToken)).toEqual([])

    await request(server())
      .get('/v1/admin/offers')
      .set(
        'Authorization',
        `Bearer ${signAccessToken({ tenantId: restaurantId, actorId: null, role: 'CASHIER' }, SECRET)}`,
      )
      .expect(403)

    await request(server())
      .get('/v1/admin/offers?filter=SECRET')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(400)
  })
})

const RETURN_TOMORROW = {
  type: 'PROMO_ON_CHECK',
  title: 'Вернём 200 ฿',
  limits: { minCheck: 80_000, perGuestQty: 1 },
  reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
}

const NO_ACTIONS = { publish: false, pause: false, end: false }

const tokenFor = (tenantId: string, role: 'OWNER' | 'MANAGER' | 'CASHIER'): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET)

interface Sent {
  readonly status: number
  readonly body: Record<string, unknown>
}

const send = async (token: string, path: string, body: object = {}): Promise<Sent> => {
  const response = await request(server())
    .post(`/v1/admin/offers${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)

  return { status: response.status, body: response.body as Record<string, unknown> }
}

const storedStatus = async (id: string): Promise<string> =>
  (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { status: true } })).status

describe('Конструктор акций', () => {
  let venueId: string
  let owner: string

  beforeAll(async () => {
    venueId = await createTenant(prisma)
    owner = tokenFor(venueId, 'OWNER')
  })

  it('ВЛАДЕЛЕЦ СОБРАЛ АКЦИЮ — ОНА СРАЗУ ИДЁТ: ТЕ ЖЕ ПРАВИЛА, ЧТО ЧИТАЕТ КАССА, И УСЛОВИЕ СЛОВАМИ', async () => {
    const created = await send(owner, '', RETURN_TOMORROW)

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'LIVE' })

    const id = created.body['id'] as string

    expect((await list(owner)).find((item) => item.id === id)).toMatchObject({
      status: 'LIVE',
      title: 'Вернём 200 ฿',
      howTo: ['Покажите код на кассе', 'Скидка 200 ฿', 'Действует 1 день с выдачи'],
      partner: null,
      actions: { publish: false, pause: true, end: true },
    })

    expect(
      await prisma.offer.findUniqueOrThrow({
        where: { id },
        select: { type: true, visibility: true, audience: true, limits: true, reward: true },
      }),
    ).toEqual({
      type: 'PROMO_ON_CHECK',
      visibility: 'VENUE_ONLY',
      audience: { kind: 'ALL' },
      limits: RETURN_TOMORROW.limits,
      reward: RETURN_TOMORROW.reward,
    })
  })

  it('ЧЕРНОВИК → ИДЁТ → ПАУЗА → ИДЁТ → ЗАВЕРШЕНА; ПОВТОР ШАГА НЕ ОШИБКА; ИЗ ЗАВЕРШЁННОЙ ХОДА НЕТ', async () => {
    const draft = await send(owner, '', { ...RETURN_TOMORROW, title: 'Черновик', launch: 'DRAFT' })

    expect(draft.body).toMatchObject({ status: 'DRAFT' })

    const id = draft.body['id'] as string

    expect((await list(owner)).find((item) => item.id === id)?.actions).toEqual({
      publish: true,
      pause: false,
      end: true,
    })

    expect((await send(owner, `/${id}/publish`)).body).toMatchObject({ status: 'LIVE' })
    expect((await send(owner, `/${id}/pause`)).body).toMatchObject({ status: 'PAUSED' })

    const again = await send(owner, `/${id}/pause`)

    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ status: 'PAUSED' })

    expect((await send(owner, `/${id}/publish`)).body).toMatchObject({ status: 'LIVE' })
    expect((await send(owner, `/${id}/end`)).body).toMatchObject({ status: 'ENDED' })

    const revived = await send(owner, `/${id}/publish`)

    expect(revived.status).toBe(409)
    expect(revived.body).toMatchObject({ error: { code: 'INVALID_TRANSITION' } })
    expect(await storedStatus(id)).toBe('ENDED')

    // Повторная пауза в аудит не попала: она ничего не изменила.
    expect(
      await prisma.auditLog.count({
        where: { tenantId: venueId, entityId: id, action: 'OFFER_STATUS_CHANGED' },
      }),
    ).toBe(4)
  })

  it('С НАЧАЛОМ ЗАВТРА — «ЗАПЛАНИРОВАНА», ХОТЯ КАССА ЕЁ УЖЕ ЗНАЕТ; С ПРОШЕДШИМ КОНЦОМ ЗАПУСТИТЬ НЕЛЬЗЯ', async () => {
    const created = await send(owner, '', {
      ...RETURN_TOMORROW,
      title: 'Завтра',
      schedule: { startsAt: new Date(Date.now() + DAY_MS).toISOString() },
    })

    expect(created.body).toMatchObject({ status: 'SCHEDULED' })

    const id = created.body['id'] as string

    expect((await list(owner, '?filter=SCHEDULED')).map((item) => item.id)).toContain(id)
    expect((await list(owner, '?filter=LIVE')).map((item) => item.id)).not.toContain(id)
    expect(await storedStatus(id)).toBe('LIVE')

    const late = await send(owner, '', {
      ...RETURN_TOMORROW,
      title: 'Вчера',
      schedule: { endsAt: new Date(Date.now() - DAY_MS).toISOString() },
    })

    expect(late.status).toBe(409)
    expect(late.body).toMatchObject({ error: { code: 'OFFER_EXPIRED' } })
  })

  it('МЕНЕДЖЕР ВИДИТ, НО НЕ СОБИРАЕТ И НЕ ПЕРЕКЛЮЧАЕТ; КАССИРУ — 403; КРИВЫЕ ПРАВИЛА — 400', async () => {
    const manager = tokenFor(venueId, 'MANAGER')
    const id = (await send(owner, '', { ...RETURN_TOMORROW, title: 'Для менеджера' })).body[
      'id'
    ] as string

    expect((await list(manager)).find((item) => item.id === id)?.actions).toEqual(NO_ACTIONS)
    expect((await send(manager, '', RETURN_TOMORROW)).status).toBe(403)
    expect((await send(manager, `/${id}/pause`)).status).toBe(403)
    expect((await send(manager, '/simulate', RETURN_TOMORROW)).status).toBe(403)
    expect((await send(tokenFor(venueId, 'CASHIER'), '', RETURN_TOMORROW)).status).toBe(403)
    expect(await storedStatus(id)).toBe('LIVE')

    const mismatch = await send(owner, '', { ...RETURN_TOMORROW, type: 'CASHBACK' })

    expect(mismatch.status).toBe(400)
    expect(mismatch.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    expect((await send(owner, '', { ...RETURN_TOMORROW, tenantId: restaurantId })).status).toBe(400)
  })

  it('ПАРТНЁРСКУЮ АКЦИЮ ИЗ СПИСКА НЕ ПЕРЕКЛЮЧИТЬ — 409; ЧУЖУЮ И ПОДАРОК ИЗ КАРТОЧКИ — 404', async () => {
    const restaurantOwner = tokenFor(restaurantId, 'OWNER')
    const partner = await send(restaurantOwner, `/${partnerOfferId}/pause`)

    expect(partner.status).toBe(409)
    expect(partner.body).toMatchObject({ error: { code: 'PARTNER_OFFER' } })
    expect(await storedStatus(partnerOfferId)).toBe('LIVE')
    expect(
      (await list(restaurantOwner)).find((item) => item.id === partnerOfferId)?.actions,
    ).toEqual(NO_ACTIONS)

    expect((await send(owner, `/${scheduledOfferId}/end`)).status).toBe(404)
    expect(await storedStatus(scheduledOfferId)).toBe('SCHEDULED')

    expect((await send(restaurantOwner, `/${goodwillOfferId}/end`)).status).toBe(404)
    expect(await storedStatus(goodwillOfferId)).toBe('LIVE')
  })
})

describe('Прогноз акции на своей истории', () => {
  const { title: _title, ...rules } = RETURN_TOMORROW

  it('НОВОЕ ЗАВЕДЕНИЕ — ЦИФР НЕТ, ТОЛЬКО ПРИЧИНА', async () => {
    const fresh = await createTenant(prisma)
    const outcome = await send(tokenFor(fresh, 'OWNER'), '/simulate', rules)

    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({ insufficientData: true })
    expect(outcome.body).not.toHaveProperty('guests')
  })

  it('ЧЕКИ ЗА 30 ДНЕЙ ИДУТ ЧЕРЕЗ ДВИЖОК КАССЫ: ПОРОГ И ЛИМИТ НА ГОСТЯ КАК НА КАССЕ, ОТМЕНЁННЫЙ ЧЕК — НЕ ВИЗИТ', async () => {
    const venue = await createTenant(prisma)

    const visit = async (
      fixture: MembershipFixture,
      amount: number,
      daysAgo: number,
    ): Promise<string> => {
      const earned = await ledgerService.earn(
        {
          membershipId: fixture.membershipId,
          amount: Math.max(1, Math.floor(amount / 20)),
          basisAmount: amount,
          idempotencyKey: idempotencyKey('offers-simulate'),
          refType: 'receipt',
          refId: `R-${randomUUID().slice(0, 8)}`,
          occurredAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
          ...POS_ORIGIN,
        },
        fixture.scope,
      )

      return earned.entry.id
    }

    // Первый чек — 40 дней назад: заведение в программе дольше окна.
    await visit(await createMembershipFixture(prisma, { tenantId: venue }), 50_000, 40)

    // Двадцать мелких чеков: история есть, порог 800 ฿ не пройден.
    for (let index = 0; index < 20; index += 1) {
      await visit(
        await createMembershipFixture(prisma, { tenantId: venue }),
        30_000,
        1 + (index % 25),
      )
    }

    // Анна трижды выше порога — но код один: лимит на гостя.
    const anna = await createMembershipFixture(prisma, { tenantId: venue })
    await visit(anna, 90_000, 3)
    await visit(anna, 95_000, 2)
    await visit(anna, 99_000, 1)

    // Борис ровно на пороге.
    await visit(await createMembershipFixture(prisma, { tenantId: venue }), 80_000, 4)

    // Большой чек отменили — визита не было.
    const cancelled = await createMembershipFixture(prisma, { tenantId: venue })
    const entryId = await visit(cancelled, 150_000, 2)
    await ledgerService.reverse(
      {
        entryId,
        idempotencyKey: idempotencyKey('offers-simulate-reverse'),
        reason: 'WRONG_AMOUNT',
        ...POS_ORIGIN,
      },
      cancelled.scope,
    )

    const outcome = await send(tokenFor(venue, 'OWNER'), '/simulate', rules)

    expect(outcome.status).toBe(200)
    expect(outcome.body).toEqual({
      insufficientData: false,
      days: 30,
      guests: 2,
      grants: 2,
      bonusPoints: null,
      cost: 40_000,
    })
  }, 120_000)
})
