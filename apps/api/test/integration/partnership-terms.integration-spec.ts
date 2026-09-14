import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { offerHowTo, offerTitle } from '@positive/contracts'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'
import { PartnershipSweepService } from '../../src/partnerships/partnership-sweep.service'
import { PartnershipTriggerService } from '../../src/partnerships/partnership-trigger.service'

import { createMembershipFixture, createTenant, idempotencyKey } from './ledger-test-context'

/**
 * Условия партнёрства и их превращение в акцию. docs/07, разделы 5, 8, 9.
 *
 * Последний тест — критерий приёмки эпика целиком: студия и ресторан
 * договариваются через API, гость покупает абонемент, разгребатель сам
 * находит продажу, кассир ресторана гасит ролл. Руками в базу — только
 * подготовка полигона: заведения, гость и кассир.
 */

const SECRET = 'partnership-terms-secret-not-used-anywhere-else'
const PIN = '5839'

type Vertical = 'RESTAURANT' | 'SPA' | 'RENTAL' | 'RETAIL' | 'OTHER'

interface Venue {
  id: string
  brandName: string
  owner: string
  manager: string
}

interface TermBody {
  id: string
  direction: 'WE_GIVE' | 'THEY_GIVE'
  status: string
  saleKindName: string | null
  proposedByUs: boolean
  pausedByUs: boolean
  grantsIssued: number
  grantsRedeemed: number
  actions: { accept: boolean; reject: boolean; pause: boolean; resume: boolean }
}

interface DetailBody {
  status: string
  terms: TermBody[]
  messages: Array<{ kind: string; text: string; fromUs: boolean }>
}

interface ErrorBody {
  error: { code: string; message: string }
}

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let sweep: PartnershipSweepService
let triggers: PartnershipTriggerService

const server = (): Server => app.getHttpServer() as Server

const sign = (tenantId: string, role: string): string =>
  signAccessToken({ tenantId, actorId: null, role }, SECRET)

const venue = async (vertical: Vertical, name: string): Promise<Venue> => {
  const id = await createTenant(prisma)
  const brandName = `${name} ${id.slice(0, 6)}`
  await prisma.tenant.update({ where: { id }, data: { vertical, brandName } })

  return { id, brandName, owner: sign(id, 'OWNER'), manager: sign(id, 'MANAGER') }
}

const post = (token: string, path: string, body: object = {}) =>
  request(server())
    .post(`/v1/admin/partnerships/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)

const detail = (token: string, id: string) =>
  request(server()).get(`/v1/admin/partnerships/${id}`).set('Authorization', `Bearer ${token}`)

const code = (response: { body: unknown }): string => (response.body as ErrorBody).error.code

const terms = (response: { body: unknown }): TermBody[] => (response.body as DetailBody).terms

/** А пригласил Б, Б согласился обсудить. */
const agree = async (from: Venue, to: Venue): Promise<string> => {
  const invited = await post(from.owner, 'invites', {
    partnerTenantId: to.id,
    text: 'Мы студия танцев через дорогу, у нас двести учеников в месяц. Давайте дружить.',
  }).expect(201)
  const id = (invited.body as { partnershipId: string }).partnershipId

  await post(to.owner, `${id}/accept`).expect(200)

  return id
}

/** Головной пример ТЗ: ресторан дарит ролл гостям студии за абонемент от 5 000 ฿. */
const rollForSubscription = (saleKindId: string): object => ({
  direction: 'WE_GIVE',
  trigger: { type: 'ON_SALE_KIND', saleKindId, minAmount: 500_000 },
  reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
  validityDays: 14,
  limits: { totalGrants: 200, perGuest: 1, dailyCap: 10 },
})

/** Студия с абонементом, ресторан, договорились обсуждать, ресторан предложил ролл. */
const proposedRoll = async (): Promise<{
  studio: Venue
  restaurant: Venue
  kindId: string
  id: string
  termId: string
  proposed: { body: unknown }
}> => {
  const studio = await venue('OTHER', 'Студия')
  const restaurant = await venue('RESTAURANT', 'Ресторан')
  const kind = await prisma.saleKind.create({
    data: { tenantId: studio.id, name: 'Абонемент на месяц' },
    select: { id: true },
  })
  const id = await agree(studio, restaurant)

  const proposed = await post(restaurant.owner, `${id}/terms`, rollForSubscription(kind.id)).expect(
    201,
  )

  return { studio, restaurant, kindId: kind.id, id, termId: terms(proposed)[0]?.id ?? '', proposed }
}

const saleEvent = (tenantId: string, guestId: string, saleKindId: string) => ({
  tenantId,
  guestId,
  sourceEntryId: randomUUID(),
  refType: 'receipt',
  saleKindId,
  basisAmount: 500_000,
  visitsTotal: 1,
  membershipCreated: true,
  occurredAt: new Date(),
})

const cashierToken = async (tenantId: string): Promise<string> => {
  const staff = await prisma.staff.create({
    data: {
      tenantId,
      role: 'CASHIER',
      displayName: 'Кассир ресторана',
      pinHash: await hashPin(PIN),
    },
    select: { id: true },
  })

  const deviceId = `device-terms-${randomUUID()}`
  await prisma.staffDevice.create({
    data: { tenantId, staffId: staff.id, deviceId, label: 'Планшет ресторана' },
  })

  const login = await request(server())
    .post('/v1/auth/staff/pin')
    .send({ deviceId, pin: PIN })
    .expect(200)

  return (login.body as { accessToken: string }).accessToken
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
  sweep = moduleRef.get(PartnershipSweepService)
  triggers = moduleRef.get(PartnershipTriggerService)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Предложить условие', () => {
  it('СТУДИЯ ВИДИТ «РОЛЛ ЗА АБОНЕМЕНТ» СО СВОИМ АБОНЕМЕНТОМ И КНОПКОЙ «ПРИНЯТЬ»', async () => {
    const { studio, id, proposed } = await proposedRoll()

    expect(terms(proposed)[0]).toMatchObject({
      direction: 'WE_GIVE',
      status: 'PROPOSED',
      // Ресторан соглашается на «абонемент», а не на идентификатор.
      saleKindName: 'Абонемент на месяц',
      proposedByUs: true,
      actions: { accept: false, reject: true },
    })

    const theirs = await detail(studio.owner, id).expect(200)
    expect(terms(theirs)[0]).toMatchObject({
      direction: 'THEY_GIVE',
      saleKindName: 'Абонемент на месяц',
      proposedByUs: false,
      actions: { accept: true },
    })
    expect((theirs.body as DetailBody).messages.at(-1)).toMatchObject({
      kind: 'TERM_PROPOSED',
      fromUs: false,
    })
  })

  it('ЧУЖОЙ ВИД ПРОДАЖ НЕ ПРОЙДЁТ: соседа, свой вместо партнёрского, выключенный', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    const stranger = await venue('SPA', 'Сосед')
    const id = await agree(studio, restaurant)

    const strangerKind = await prisma.saleKind.create({
      data: { tenantId: stranger.id, name: 'Массаж' },
      select: { id: true },
    })
    const ownKind = await prisma.saleKind.create({
      data: { tenantId: restaurant.id, name: 'Банкет' },
      select: { id: true },
    })
    const offKind = await prisma.saleKind.create({
      data: { tenantId: studio.id, name: 'Старый абонемент', isActive: false },
      select: { id: true },
    })

    for (const kindId of [strangerKind.id, ownKind.id, offKind.id]) {
      const response = await post(
        restaurant.owner,
        `${id}/terms`,
        rollForSubscription(kindId),
      ).expect(400)

      expect(code(response)).toBe('SALE_KIND_NOT_FOUND')
    }
  })

  it('ШТАМПЫ И БАЛЛЫ — 400 С ОБЪЯСНЕНИЕМ: условие без механики не сработало бы ни разу', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    const id = await agree(studio, restaurant)

    const stamps = await post(restaurant.owner, `${id}/terms`, {
      direction: 'WE_GIVE',
      trigger: { type: 'ON_STAMP_COMPLETE' },
      reward: { kind: 'FREE_ITEM', itemName: 'Кофе', minCheck: 0 },
      limits: {},
    }).expect(400)
    expect((stamps.body as ErrorBody).error.message).toContain('Штампов')

    const points = await post(restaurant.owner, `${id}/terms`, {
      direction: 'WE_GIVE',
      trigger: { type: 'ON_PURCHASE', minAmount: 100_000 },
      reward: { kind: 'FIXED_POINTS', amount: 5_000 },
      limits: {},
    }).expect(400)
    expect((points.body as ErrorBody).error.message).toContain('касса')
  })

  it('до принятия приглашения условия не обсуждают', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const invited = await post(studio.owner, 'invites', {
      partnerTenantId: restaurant.id,
      text: 'Мы студия танцев через дорогу, у нас двести учеников в месяц. Давайте дружить.',
    }).expect(201)
    const id = (invited.body as { partnershipId: string }).partnershipId

    const response = await post(studio.owner, `${id}/terms`, {
      direction: 'THEY_GIVE',
      trigger: { type: 'ON_PURCHASE', minAmount: 100_000 },
      reward: { kind: 'PERCENT_OFF', percent: 10, maxDiscount: null },
      limits: {},
    }).expect(409)

    expect(code(response)).toBe('PARTNERSHIP_STATE')
  })

  it('посторонний — 404, менеджер — 403', async () => {
    const { restaurant, id, termId, kindId } = await proposedRoll()
    const outsider = await venue('RETAIL', 'Посторонний')

    await post(outsider.owner, `${id}/terms`, rollForSubscription(kindId)).expect(404)
    await post(outsider.owner, `${id}/terms/${termId}/accept`).expect(404)
    await request(server())
      .get(`/v1/admin/partnerships/${id}/sale-kinds`)
      .set('Authorization', `Bearer ${outsider.owner}`)
      .expect(404)

    await post(restaurant.manager, `${id}/terms`, rollForSubscription(kindId)).expect(403)
  })
})

describe('Принять условие', () => {
  it('СВОЁ УСЛОВИЕ НЕ ПРИНЯТЬ: предложив, вы уже согласились', async () => {
    const { restaurant, id, termId } = await proposedRoll()

    expect(code(await post(restaurant.owner, `${id}/terms/${termId}/accept`).expect(403))).toBe(
      'NOT_COUNTERPARTY',
    )
  })

  it('ПРИНЯТОЕ УСЛОВИЕ РОЖДАЕТ АКЦИЮ У ДАЮЩЕГО ПОДАРОК — С ТЕКСТАМИ ДЛЯ ГОСТЯ И КАССИРА', async () => {
    const { studio, restaurant, id, termId } = await proposedRoll()

    const accepted = await post(studio.owner, `${id}/terms/${termId}/accept`).expect(200)

    expect((accepted.body as DetailBody).status).toBe('ACTIVE')
    expect(terms(accepted)[0]).toMatchObject({ status: 'ACTIVE', actions: { pause: true } })

    const term = await prisma.partnershipTerm.findUniqueOrThrow({ where: { id: termId } })
    expect(term.offerId).not.toBeNull()

    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: term.offerId ?? '' } })
    expect(offer).toMatchObject({ tenantId: restaurant.id, visibility: 'PARTNER', status: 'LIVE' })
    expect(offerTitle(offer.i18n, 'ru')).toBe('Ролл Филадельфия в подарок')
    expect(offerHowTo(offer.i18n, 'ru')).toEqual([
      'Покажите код на кассе',
      'К заказу от 800 ฿',
      `Подарок от партнёра — ${studio.brandName}`,
    ])
  })

  it('ДВА «ПРИНЯТЬ» ОДНОВРЕМЕННО — ОДНА АКЦИЯ', async () => {
    const { studio, restaurant, id, termId } = await proposedRoll()

    const [first, second] = await Promise.all([
      post(studio.owner, `${id}/terms/${termId}/accept`),
      post(studio.owner, `${id}/terms/${termId}/accept`),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(
      await prisma.offer.count({ where: { tenantId: restaurant.id, visibility: 'PARTNER' } }),
    ).toBe(1)
  })

  it('отклонить чужое, отозвать своё — и принять закрытое уже нельзя', async () => {
    const { studio, restaurant, id, termId, kindId } = await proposedRoll()

    const rejected = await post(studio.owner, `${id}/terms/${termId}/reject`, {
      reason: 'Абонементы на месяц закончились',
    }).expect(200)
    expect(terms(rejected).find((term) => term.id === termId)?.status).toBe('ENDED')

    const ours = await detail(restaurant.owner, id).expect(200)
    expect((ours.body as DetailBody).messages.at(-1)).toMatchObject({
      kind: 'TERM_REJECTED',
      text: 'Абонементы на месяц закончились',
      fromUs: false,
    })

    expect(code(await post(studio.owner, `${id}/terms/${termId}/accept`).expect(409))).toBe(
      'TERM_STATE',
    )

    const again = await post(restaurant.owner, `${id}/terms`, rollForSubscription(kindId)).expect(
      201,
    )
    const second = terms(again).find((term) => term.status === 'PROPOSED')?.id ?? ''

    const withdrawn = await post(restaurant.owner, `${id}/terms/${second}/reject`).expect(200)
    expect(terms(withdrawn).find((term) => term.id === second)?.status).toBe('ENDED')
  })
})

describe('Пауза', () => {
  it('ПАУЗА: НОВЫХ ПОДАРКОВ НЕТ, СНЯТЬ МОЖЕТ ТОЛЬКО ПОСТАВИВШИЙ', async () => {
    const { studio, restaurant, id, termId, kindId } = await proposedRoll()
    await post(studio.owner, `${id}/terms/${termId}/accept`).expect(200)

    const guest = await createMembershipFixture(prisma, { tenantId: studio.id })

    const paused = await post(studio.owner, `${id}/terms/${termId}/pause`).expect(200)
    expect(terms(paused)[0]).toMatchObject({
      status: 'PAUSED',
      pausedByUs: true,
      actions: { resume: true },
    })

    const theirs = await detail(restaurant.owner, id).expect(200)
    expect(terms(theirs)[0]).toMatchObject({ pausedByUs: false, actions: { resume: false } })

    // Ресторану гости студии выгодны — но снять паузу студии он не может.
    expect(code(await post(restaurant.owner, `${id}/terms/${termId}/resume`).expect(403))).toBe(
      'NOT_PAUSER',
    )

    expect(await triggers.handle(saleEvent(studio.id, guest.guestId, kindId))).toEqual([])

    await post(studio.owner, `${id}/terms/${termId}/resume`).expect(200)

    expect(await triggers.handle(saleEvent(studio.id, guest.guestId, kindId))).toHaveLength(1)
  })
})

describe('Виды продаж для конструктора', () => {
  it('наши и их включённые виды продаж — чтобы предложить «за абонемент»', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    await prisma.saleKind.createMany({
      data: [
        { tenantId: studio.id, name: 'Абонемент на месяц' },
        { tenantId: studio.id, name: 'Выключенный', isActive: false },
        { tenantId: restaurant.id, name: 'Банкет' },
      ],
    })
    const id = await agree(studio, restaurant)

    const response = await request(server())
      .get(`/v1/admin/partnerships/${id}/sale-kinds`)
      .set('Authorization', `Bearer ${restaurant.owner}`)
      .expect(200)

    const body = response.body as {
      ours: Array<{ name: string }>
      theirs: Array<{ name: string }>
    }
    expect(body.ours.map((kind) => kind.name)).toEqual(['Банкет'])
    expect(body.theirs.map((kind) => kind.name)).toEqual(['Абонемент на месяц'])
  })
})

describe('Критерий приёмки эпика', () => {
  it('ДОГОВОРИЛИСЬ → ГОСТЬ КУПИЛ АБОНЕМЕНТ → ПОЛУЧИЛ РОЛЛ → ПОГАСИЛ В РЕСТОРАНЕ → ОБЕ СТОРОНЫ ВИДЯТ ЦИФРЫ', async () => {
    const { studio, restaurant, id, termId, kindId } = await proposedRoll()
    await post(studio.owner, `${id}/terms/${termId}/accept`).expect(200)

    const term = await prisma.partnershipTerm.findUniqueOrThrow({ where: { id: termId } })
    const offerId = term.offerId ?? ''

    // Кассир студии проводит абонемент на 5 000 ₿ — обычное начисление с видом продажи.
    const guest = await createMembershipFixture(prisma, { tenantId: studio.id })
    await ledger.earn(
      {
        membershipId: guest.membershipId,
        amount: 25_000,
        basisAmount: 500_000,
        idempotencyKey: idempotencyKey('terms-chain'),
        refType: 'receipt',
        refId: `R-${randomUUID().slice(0, 8)}`,
        saleKindId: kindId,
        source: 'STAFF_MANUAL',
        actorType: 'STAFF',
      },
      guest.scope,
    )

    // Никто не зовёт слушателя руками: разгребатель сам находит продажу.
    // Фоновый проход приложения может успеть раньше — ждём сам промокод.
    let grant: { code: string } | null = null
    for (let attempt = 0; attempt < 10 && grant === null; attempt += 1) {
      await sweep.tick()
      grant = await prisma.offerGrant.findFirst({
        where: { offerId, guestId: guest.guestId },
        select: { code: true },
      })
    }

    expect(grant).not.toBeNull()

    const afterIssue = await detail(studio.owner, id).expect(200)
    expect(terms(afterIssue)[0]).toMatchObject({ grantsIssued: 1, grantsRedeemed: 0 })

    const cashier = await cashierToken(restaurant.id)
    const redeemed = await request(server())
      .post('/v1/pos/grants/redeem')
      .set('Authorization', `Bearer ${cashier}`)
      .send({ code: grant?.code ?? '', receiptId: `R-${randomUUID().slice(0, 8)}` })
      .expect(200)

    expect(redeemed.body).toMatchObject({ title: 'Ролл Филадельфия в подарок', replayed: false })

    // Цифры видят обе стороны — и только цифры.
    for (const token of [studio.owner, restaurant.owner]) {
      const view = await detail(token, id).expect(200)
      expect(terms(view)[0]).toMatchObject({ grantsIssued: 1, grantsRedeemed: 1 })
      expect(JSON.stringify(view.body)).not.toContain(grant?.code ?? '—')
    }
  })
})
