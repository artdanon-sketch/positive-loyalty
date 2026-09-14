import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { PartnershipTriggerService } from '../../src/partnerships/partnership-trigger.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'

/**
 * Партнёрства: договориться. docs/07, разделы 5, 6, 9 · docs/02, раздел 5.8.
 *
 * Каждый тест заводит свои заведения: сценарии не зависят от порядка
 * и друг от друга, а общая тестовая база не превращается в клубок пар.
 */

const SECRET = 'partnerships-negotiation-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000
const PITCH = 'Мы студия танцев через дорогу, у нас двести учеников в месяц. Давайте дружить.'

type Vertical = 'RESTAURANT' | 'SPA' | 'RENTAL' | 'RETAIL' | 'OTHER'

interface Venue {
  id: string
  brandName: string
  owner: string
  manager: string
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

interface DetailBody {
  id: string
  status: string
  direction: 'OUTGOING' | 'INCOMING'
  partner: { tenantId: string; brandName: string | null }
  endReason: string | null
  messages: Array<{ kind: string; text: string; fromUs: boolean }>
  actions: { accept: boolean; decline: boolean; end: boolean; block: boolean; message: boolean }
}

let app: INestApplication
let prisma: PrismaService
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

const invite = (token: string, partnerTenantId: string, text: string = PITCH) =>
  request(server())
    .post('/v1/admin/partnerships/invites')
    .set('Authorization', `Bearer ${token}`)
    .send({ partnerTenantId, text })

const act = (token: string, id: string, action: string, body: object = {}) =>
  request(server())
    .post(`/v1/admin/partnerships/${id}/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)

const detail = (token: string, id: string) =>
  request(server()).get(`/v1/admin/partnerships/${id}`).set('Authorization', `Bearer ${token}`)

const get = (token: string, path: string) =>
  request(server()).get(`/v1/admin/${path}`).set('Authorization', `Bearer ${token}`)

const code = (response: { body: unknown }): string => (response.body as ErrorBody).error.code

/** А пригласил Б, Б согласился обсудить. Возвращает id партнёрства. */
const agree = async (from: Venue, to: Venue): Promise<string> => {
  const invited = await invite(from.owner, to.id).expect(201)
  const id = (invited.body as { partnershipId: string }).partnershipId
  await act(to.owner, id, 'accept').expect(200)
  return id
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
  triggers = moduleRef.get(PartnershipTriggerService)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Каталог сети', () => {
  it('витрина соседей: дополняющие первыми, себя нет, лишних полей нет', async () => {
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    const spa = await venue('SPA', 'Спа')
    const rival = await venue('RESTAURANT', 'Конкурент')

    const response = await get(restaurant.owner, 'partners/catalog').expect(200)
    const items = (response.body as { items: Array<Record<string, unknown>> }).items

    expect(items.some((item) => item['tenantId'] === restaurant.id)).toBe(false)
    expect(items.some((item) => item['tenantId'] === spa.id)).toBe(true)
    expect(items.some((item) => item['tenantId'] === rival.id)).toBe(true)

    // Ресторану проще договориться со спа, чем с другим рестораном.
    const firstRival = items.findIndex((item) => item['vertical'] === 'RESTAURANT')
    expect(items.slice(firstRival).every((item) => item['vertical'] === 'RESTAURANT')).toBe(true)

    const probe = items.find((item) => item['tenantId'] === spa.id)
    expect(Object.keys(probe ?? {}).sort()).toEqual([
      'brandName',
      'guestsApprox',
      'partnership',
      'tenantId',
      'vertical',
    ])
  })

  it('кассиру каталог не положен', async () => {
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    await get(sign(restaurant.id, 'CASHIER'), 'partners/catalog').expect(403)
  })
})

describe('Приглашение', () => {
  it('А ПРИГЛАШАЕТ Б — Б ВИДИТ ЕГО ПЕРВЫМ В СПИСКЕ, С ТЕКСТОМ И КНОПКОЙ «ПРИНЯТЬ»', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const sent = await invite(studio.owner, restaurant.id).expect(201)
    const { partnershipId, quota } = sent.body as {
      partnershipId: string
      quota: { freeUsed: number }
    }
    expect(quota.freeUsed).toBe(1)

    const inbox = await get(restaurant.owner, 'partnerships').expect(200)
    const first = (inbox.body as { items: DetailBody[] }).items[0]
    expect(first).toMatchObject({
      id: partnershipId,
      status: 'PROPOSED',
      direction: 'INCOMING',
      partner: { tenantId: studio.id, brandName: studio.brandName },
    })

    const theirs = (await detail(restaurant.owner, partnershipId).expect(200)).body as DetailBody
    expect(theirs.messages).toEqual([
      expect.objectContaining({ kind: 'INVITE', text: PITCH, fromUs: false }),
    ])
    expect(theirs.actions).toMatchObject({ accept: true, decline: true, message: false })

    const ours = (await detail(studio.owner, partnershipId).expect(200)).body as DetailBody
    expect(ours.direction).toBe('OUTGOING')
    expect(ours.actions.accept).toBe(false)
  })

  it('ПОСТОРОННИЙ НЕ ВИДИТ ЧУЖОГО ПАРТНЁРСТВА ДАЖЕ ПО ID — 404 на чтение и на действия', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    const outsider = await venue('SPA', 'Посторонний')

    const sent = await invite(studio.owner, restaurant.id).expect(201)
    const id = (sent.body as { partnershipId: string }).partnershipId

    await detail(outsider.owner, id).expect(404)
    await act(outsider.owner, id, 'accept').expect(404)
    await act(outsider.owner, id, 'block').expect(404)

    const list = await get(outsider.owner, 'partnerships').expect(200)
    expect((list.body as { items: DetailBody[] }).items.some((item) => item.id === id)).toBe(false)
  })

  it('ОДНА ПАРА — ОДНО ПАРТНЁРСТВО: встречное приглашение отбивается', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const sent = await invite(studio.owner, restaurant.id).expect(201)
    const back = await invite(restaurant.owner, studio.id).expect(409)

    expect(code(back)).toBe('PARTNERSHIP_EXISTS')
    expect((back.body as ErrorBody).error.details).toMatchObject({
      partnershipId: (sent.body as { partnershipId: string }).partnershipId,
    })
  })

  it('ДВА ВСТРЕЧНЫХ ПРИГЛАШЕНИЯ В ОДНУ СЕКУНДУ — ВСЁ РАВНО ОДНО ПАРТНЁРСТВО', async () => {
    const spa = await venue('SPA', 'Спа')
    const shop = await venue('RETAIL', 'Лавка')

    const [first, second] = await Promise.all([
      invite(spa.owner, shop.id),
      invite(shop.owner, spa.id),
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])
    expect(
      await prisma.partnership.count({
        where: {
          OR: [
            { initiatorTenantId: spa.id, partnerTenantId: shop.id },
            { initiatorTenantId: shop.id, partnerTenantId: spa.id },
          ],
        },
      }),
    ).toBe(1)
  })

  it('«привет» — не приглашение: короче сорока знаков отбивается с понятной причиной', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const response = await invite(studio.owner, restaurant.id, 'Привет!').expect(400)

    expect((response.body as ErrorBody).error.message).toContain('кто вы')
  })

  it('себя и закрытое заведение пригласить нельзя', async () => {
    const studio = await venue('OTHER', 'Студия')
    const closed = await venue('RESTAURANT', 'Закрылись')
    await prisma.tenant.update({ where: { id: closed.id }, data: { status: 'CHURNED' } })

    expect(code(await invite(studio.owner, studio.id).expect(400))).toBe('SELF_INVITE')
    expect(code(await invite(studio.owner, closed.id).expect(404))).toBe('PARTNER_NOT_FOUND')
  })

  it('менеджер смотрит, но не договаривается от имени заведения', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    await get(studio.manager, 'partnerships').expect(200)
    await invite(studio.manager, restaurant.id).expect(403)
  })
})

describe('Ответ на приглашение', () => {
  it('ОТВЕТИТЬ МОЖЕТ ТОЛЬКО ПРИГЛАШЁННЫЙ', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const sent = await invite(studio.owner, restaurant.id).expect(201)
    const id = (sent.body as { partnershipId: string }).partnershipId

    expect(code(await act(studio.owner, id, 'accept').expect(403))).toBe('NOT_RECIPIENT')
    expect(code(await act(studio.owner, id, 'decline').expect(403))).toBe('NOT_RECIPIENT')
  })

  it('до принятия писать нельзя; после — обе стороны видят переписку', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const sent = await invite(studio.owner, restaurant.id).expect(201)
    const id = (sent.body as { partnershipId: string }).partnershipId

    // Иначе отправитель заваливал бы получателя сообщениями без его согласия.
    await act(studio.owner, id, 'messages', { text: 'Ну что, договоримся?' }).expect(409)

    const accepted = await act(restaurant.owner, id, 'accept').expect(200)
    expect((accepted.body as DetailBody).status).toBe('NEGOTIATING')

    await act(studio.owner, id, 'messages', { text: 'Предлагаем ролл за абонемент' }).expect(201)

    const theirs = (await detail(restaurant.owner, id).expect(200)).body as DetailBody
    expect(theirs.messages.map((message) => message.kind)).toEqual(['INVITE', 'TEXT'])
    expect(theirs.messages.at(-1)).toMatchObject({
      text: 'Предлагаем ролл за абонемент',
      fromUs: false,
    })
  })

  it('ОТКАЗ — МЕСЯЦ ТИШИНЫ ДЛЯ ПРИГЛАСИВШЕГО, но не для отказавшего', async () => {
    const studio = await venue('OTHER', 'Студия')
    const spa = await venue('SPA', 'Спа')

    const sent = await invite(studio.owner, spa.id).expect(201)
    const id = (sent.body as { partnershipId: string }).partnershipId

    const declined = await act(spa.owner, id, 'decline', { reason: 'Не наш профиль' }).expect(200)
    expect((declined.body as DetailBody).status).toBe('DECLINED')

    const again = await invite(studio.owner, spa.id).expect(409)
    expect(code(again)).toBe('INVITE_COOLDOWN')
    const retryAfter = new Date(String((again.body as ErrorBody).error.details?.['retryAfter']))
    expect(retryAfter.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS)

    // Отказавший передумал сам — ждать ему незачем. Строка пары та же.
    const reverse = await invite(spa.owner, studio.id).expect(201)
    expect((reverse.body as { partnershipId: string }).partnershipId).toBe(id)
  })

  it('БЛОКИРОВКА: заблокированный не пригласит снова и не узнает причину', async () => {
    const spammer = await venue('RETAIL', 'Спамер')
    const restaurant = await venue('RESTAURANT', 'Ресторан')

    const sent = await invite(spammer.owner, restaurant.id).expect(201)
    const id = (sent.body as { partnershipId: string }).partnershipId

    const blocked = await act(restaurant.owner, id, 'block', { reason: 'спам третий раз' }).expect(
      200,
    )
    expect((blocked.body as DetailBody).status).toBe('DECLINED')

    // Месяц тишины обошёл бы блокировку через тридцать дней — поэтому
    // проверяем именно её, сдвинув отказ в прошлое.
    await prisma.partnership.update({
      where: { id },
      data: { declinedAt: new Date(Date.now() - 60 * DAY_MS) },
    })

    const retry = await invite(spammer.owner, restaurant.id).expect(403)
    expect(code(retry)).toBe('BLOCKED_BY_RECIPIENT')
    expect(JSON.stringify(retry.body)).not.toContain('спам третий раз')

    const catalog = await get(restaurant.owner, 'partners/catalog').expect(200)
    expect(
      (catalog.body as { items: Array<{ tenantId: string }> }).items.some(
        (item) => item.tenantId === spammer.id,
      ),
    ).toBe(false)
  })
})

describe('Расторжение', () => {
  it('НОВЫЕ ПОДАРКИ ПРЕКРАЩАЮТСЯ СРАЗУ, ВЫДАННЫЕ ДОГОРАЮТ ДО СВОЕГО СРОКА', async () => {
    const studio = await venue('OTHER', 'Студия')
    const restaurant = await venue('RESTAURANT', 'Ресторан')
    const id = await agree(studio, restaurant)

    const guest = await createMembershipFixture(prisma, { tenantId: studio.id })

    const offer = await prisma.offer.create({
      data: {
        tenantId: restaurant.id,
        type: 'NETWORK_VOUCHER',
        status: 'LIVE',
        audience: {},
        schedule: {},
        limits: {},
        reward: {},
        visibility: 'PARTNER',
        i18n: {},
      },
      select: { id: true },
    })

    const term = await prisma.partnershipTerm.create({
      data: {
        partnershipId: id,
        triggerTenantId: studio.id,
        rewardTenantId: restaurant.id,
        offerId: offer.id,
        trigger: { type: 'ON_PURCHASE', minAmount: 0 },
        reward: { kind: 'FREE_ITEM', itemName: 'Ролл', minCheck: 0 },
        limits: { perGuest: 5 },
        status: 'ACTIVE',
        proposedBy: studio.id,
      },
      select: { id: true },
    })

    const giftCode = `END${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
    const grant = await prisma.offerGrant.create({
      data: {
        offerId: offer.id,
        tenantId: restaurant.id,
        guestId: guest.guestId,
        code: giftCode,
        nonce: `nonce-${giftCode}`,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
      select: { id: true },
    })

    const ended = await act(studio.owner, id, 'end', { reason: 'Закрываемся на ремонт' }).expect(
      200,
    )
    const body = ended.body as DetailBody
    expect(body).toMatchObject({ status: 'ENDED', endReason: 'Закрываемся на ремонт' })
    expect(body.actions).toMatchObject({ end: false, message: false })

    expect(
      (await prisma.partnershipTerm.findUniqueOrThrow({ where: { id: term.id } })).status,
    ).toBe('ENDED')
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('ENDED')

    // Выданный код гость погасит: его не обманули.
    expect((await prisma.offerGrant.findUniqueOrThrow({ where: { id: grant.id } })).state).toBe(
      'ISSUED',
    )

    // А новый чек у студии подарка уже не рождает.
    const issued = await triggers.handle({
      tenantId: studio.id,
      guestId: guest.guestId,
      sourceEntryId: randomUUID(),
      refType: 'receipt',
      saleKindId: null,
      basisAmount: 100_000,
      visitsTotal: 2,
      membershipCreated: false,
      occurredAt: new Date(),
    })
    expect(issued).toEqual([])

    expect(code(await act(restaurant.owner, id, 'end').expect(409))).toBe('PARTNERSHIP_STATE')
  })
})

describe('Квота приглашений', () => {
  it('КВОТА КОНЧАЕТСЯ — 402; ОТБИТОЕ ПРИГЛАШЕНИЕ ЕЁ НЕ ТРАТИТ', async () => {
    // Прайс для проката — два бесплатных в сутки. Своя вертикаль, чтобы
    // умолчания для всех остальных заведений тестовой базы не сдвинулись.
    await prisma.partnershipPricing.upsert({
      where: { vertical: 'RENTAL' },
      create: { vertical: 'RENTAL', freeInvitesPerDay: 2, extraInvitePrice: 5_000 },
      update: { freeInvitesPerDay: 2, extraInvitePrice: 5_000, maxActivePartnerships: 20 },
    })

    const rental = await venue('RENTAL', 'Прокат')
    const [first, second, third] = await Promise.all([
      venue('RESTAURANT', 'Первый'),
      venue('SPA', 'Второй'),
      venue('RETAIL', 'Третий'),
    ])

    const one = await invite(rental.owner, first.id).expect(201)
    expect((one.body as { quota: { freeLeft: number } }).quota.freeLeft).toBe(1)

    // Отбитые — не в счёт.
    await invite(rental.owner, rental.id).expect(400)
    await invite(rental.owner, second.id, 'Коротко').expect(400)
    await invite(rental.owner, first.id).expect(409)

    const quota = await get(rental.owner, 'partnerships/quota').expect(200)
    expect(quota.body).toEqual({ freeLimit: 2, freeUsed: 1, freeLeft: 1, restriction: null })

    await invite(rental.owner, second.id).expect(201)

    const over = await invite(rental.owner, third.id).expect(402)
    expect(code(over)).toBe('INVITE_QUOTA_EXCEEDED')
    expect((over.body as ErrorBody).error.details).toMatchObject({ freeLeft: 0, extraPrice: 5_000 })

    // Приглашения сверх квоты не существует: третий ничего не получил.
    const inbox = await get(third.owner, 'partnerships').expect(200)
    expect((inbox.body as { items: unknown[] }).items).toHaveLength(0)
  })
})
