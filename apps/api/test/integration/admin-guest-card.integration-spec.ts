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

import { createMembershipFixture, idempotencyKey } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Поиск гостя и карточка гостя. docs/02, раздел 5.2 · docs/10, раздел 5.2.
 *
 * Полигон: наш гость с двумя чеками (один отменён), подарком, погашенным
 * в первом чеке, и подарком, срок которого прошёл. У соседнего заведения —
 * гость с тем же именем, свой промокод и подарок, выданный НАШЕМУ гостю.
 * Последние три — ловушки: всё это существует, и ничего из этого не должно
 * просочиться в наш поиск и нашу карточку.
 */

const SECRET = 'admin-guest-card-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000
const NAME = 'Анна Поисковая'

let app: INestApplication
let prisma: PrismaService
let own: MembershipFixture
let foreign: MembershipFixture
let managerToken: string
let ownerToken: string
let cashierToken: string

const receipt = `R-${randomUUID().slice(0, 8)}`
const voidedReceipt = `R-${randomUUID().slice(0, 8)}`
let earnedEntryId: string
let voidedEntryId: string
let redeemedCode: string
let redeemedGrantId: string
let expiredGrantId: string
let neighbourCode: string
let neighbourGrantId: string
let foreignCode: string

const server = (): Server => app.getHttpServer() as Server

interface GuestsBody {
  items: Array<{ membershipId: string; phone: string | null }>
  total: number
}

type TimelineItem = Record<string, unknown> & { kind: 'OPERATION' | 'GIFT'; at: string }

interface CardBody {
  guestId: string
  phone: string | null
  visitsTotal: number
  spentTotal: number
  averageCheck: number | null
  timeline: TimelineItem[]
  timelineTruncated: boolean
}

/** Код подарка: латиница и цифры, как у настоящих, но заведомо уникальный. */
const newCode = (): string => `G${randomUUID().replace(/-/g, '').slice(0, 11).toUpperCase()}`

const createOffer = async (tenantId: string, title: Record<string, string>): Promise<string> => {
  const offer = await prisma.forTenant(tenantId, async (tx) =>
    tx.offer.create({
      data: {
        tenantId,
        type: 'NETWORK_VOUCHER',
        status: 'LIVE',
        audience: {},
        schedule: {},
        limits: {},
        reward: {},
        visibility: 'PARTNER',
        i18n: { title },
      },
      select: { id: true },
    }),
  )

  return offer.id
}

interface GrantSeed {
  tenantId: string
  guestId: string
  offerId: string
  code: string
  expiresAt: Date
  issuedAt?: Date
  state?: 'ISSUED' | 'REDEEMED'
  redeemedAt?: Date
  redeemedReceiptId?: string
}

const createGrant = async (seed: GrantSeed): Promise<string> => {
  const grant = await prisma.forTenant(seed.tenantId, async (tx) =>
    tx.offerGrant.create({
      data: { ...seed, nonce: `nonce-${seed.code}` },
      select: { id: true },
    }),
  )

  return grant.id
}

const search = (q: string, token: string = managerToken) =>
  request(server())
    .get(`/v1/admin/guests?limit=100&q=${encodeURIComponent(q)}`)
    .set('Authorization', `Bearer ${token}`)

const card = (guestId: string, token: string = managerToken, query = '') =>
  request(server())
    .get(`/v1/admin/guests/${guestId}${query}`)
    .set('Authorization', `Bearer ${token}`)

const includes = (body: GuestsBody, fixture: MembershipFixture): boolean =>
  body.items.some((row) => row.membershipId === fixture.membershipId)

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

  own = await createMembershipFixture(prisma)
  foreign = await createMembershipFixture(prisma)
  const tenantId = own.tenantId

  // Одно имя у двух гостей двух заведений: поиск по имени обязан найти только своего.
  await prisma.guest.update({ where: { id: own.guestId }, data: { displayName: NAME } })
  await prisma.guest.update({ where: { id: foreign.guestId }, data: { displayName: NAME } })

  const staff = await prisma.staff.create({
    data: { tenantId, displayName: 'Кассир Лек', role: 'CASHIER' },
    select: { id: true },
  })
  const saleKind = await prisma.saleKind.create({
    data: { tenantId, name: 'Абонемент' },
    select: { id: true },
  })

  const byStaff = {
    source: 'STAFF_MANUAL' as const,
    actorType: 'STAFF' as const,
    actorId: staff.id,
  }

  const earned = await ledger.earn(
    {
      membershipId: own.membershipId,
      amount: 4_500,
      basisAmount: 90_000,
      idempotencyKey: idempotencyKey('card-earn'),
      refType: 'receipt',
      refId: receipt,
      saleKindId: saleKind.id,
      ...byStaff,
    },
    own.scope,
  )
  earnedEntryId = earned.entry.id

  const voided = await ledger.earn(
    {
      membershipId: own.membershipId,
      amount: 1_000,
      basisAmount: 20_000,
      idempotencyKey: idempotencyKey('card-voided'),
      refType: 'receipt',
      refId: voidedReceipt,
      ...byStaff,
    },
    own.scope,
  )
  voidedEntryId = voided.entry.id

  await ledger.reverse(
    {
      entryId: voidedEntryId,
      idempotencyKey: idempotencyKey('card-reverse'),
      reason: 'STAFF_ERROR',
      ...byStaff,
    },
    own.scope,
  )

  const offerId = await createOffer(tenantId, { ru: 'Десерт в подарок', en: 'Free dessert' })

  redeemedCode = newCode()
  redeemedGrantId = await createGrant({
    tenantId,
    guestId: own.guestId,
    offerId,
    code: redeemedCode,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    state: 'REDEEMED',
    redeemedAt: new Date(),
    redeemedReceiptId: receipt,
  })

  // Срок прошёл, а в базе подарок всё ещё «выдан» — фоновая задача не успела.
  expiredGrantId = await createGrant({
    tenantId,
    guestId: own.guestId,
    offerId,
    code: newCode(),
    issuedAt: new Date(Date.now() - 40 * DAY_MS),
    expiresAt: new Date(Date.now() - DAY_MS),
  })

  // Сосед выдал подарок НАШЕМУ гостю — это его программа, не наша.
  const neighbourOffer = await createOffer(foreign.tenantId, { ru: 'Кофе от соседа' })
  neighbourCode = newCode()
  neighbourGrantId = await createGrant({
    tenantId: foreign.tenantId,
    guestId: own.guestId,
    offerId: neighbourOffer,
    code: neighbourCode,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
  })

  foreignCode = newCode()
  await createGrant({
    tenantId: foreign.tenantId,
    guestId: foreign.guestId,
    offerId: neighbourOffer,
    code: foreignCode,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
  })

  const sign = (role: string): string => signAccessToken({ tenantId, actorId: null, role }, SECRET)

  managerToken = sign('MANAGER')
  ownerToken = sign('OWNER')
  cashierToken = sign('CASHIER')
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Поиск гостя одной строкой', () => {
  it('последние четыре цифры телефона находят гостя, телефон менеджеру — маской', async () => {
    const response = await search(own.guestPhone.slice(-4)).expect(200)
    const body = response.body as GuestsBody

    expect(includes(body, own)).toBe(true)
    const row = body.items.find((item) => item.membershipId === own.membershipId)
    expect(row?.phone).not.toBe(own.guestPhone)
  })

  it('имя ищется по части и без учёта регистра', async () => {
    const response = await search('поисковая').expect(200)

    expect(includes(response.body as GuestsBody, own)).toBe(true)
  })

  it('номер чека находит гостя — гость может показать чек', async () => {
    const response = await search(receipt).expect(200)
    const body = response.body as GuestsBody

    expect(body.total).toBe(1)
    expect(includes(body, own)).toBe(true)
  })

  it('промокод находит гостя, регистр не важен', async () => {
    const response = await search(redeemedCode.toLowerCase()).expect(200)

    expect(includes(response.body as GuestsBody, own)).toBe(true)
  })

  it('ПОИСК НЕ ВЫХОДИТ ЗА СВОЁ ЗАВЕДЕНИЕ: тёзка соседа не находится', async () => {
    const response = await search(NAME).expect(200)
    const body = response.body as GuestsBody

    expect(includes(body, own)).toBe(true)
    expect(includes(body, foreign)).toBe(false)
  })

  it('ПРОМОКОД СОСЕДА НЕ ИЩЕТСЯ — даже выданный нашему же гостю', async () => {
    const neighbours = await search(neighbourCode).expect(200)
    const strangers = await search(foreignCode).expect(200)

    expect((neighbours.body as GuestsBody).total).toBe(0)
    expect((strangers.body as GuestsBody).total).toBe(0)
  })

  it('пустой поиск — обычный список, а не «никого»', async () => {
    const response = await search('').expect(200)

    expect(includes(response.body as GuestsBody, own)).toBe(true)
  })

  it('строка длиннее 64 знаков — 400', async () => {
    await search('7'.repeat(65)).expect(400)
  })
})

describe('Карточка гостя', () => {
  it('ИСТОРИЯ ОДНОЙ ЛЕНТОЙ: чек с кассиром и видом продажи, отмена, путь подарка', async () => {
    const response = await card(own.guestId).expect(200)
    const body = response.body as CardBody

    const operations = body.timeline.filter((item) => item.kind === 'OPERATION')
    const gifts = body.timeline.filter((item) => item.kind === 'GIFT')

    expect(operations.find((item) => item['id'] === earnedEntryId)).toMatchObject({
      type: 'EARN',
      amount: 4_500,
      basisAmount: 90_000,
      receiptId: receipt,
      saleKind: 'Абонемент',
      staffName: 'Кассир Лек',
      reversed: false,
    })
    expect(operations.find((item) => item['id'] === voidedEntryId)).toMatchObject({
      reversed: true,
    })
    expect(operations.some((item) => item['type'] === 'REVERSAL')).toBe(true)

    expect(gifts.find((item) => item['grantId'] === redeemedGrantId)).toMatchObject({
      state: 'REDEEMED',
      redeemedReceiptId: receipt,
      title: 'Десерт в подарок',
      codeTail: redeemedCode.slice(-4),
    })

    // Новые сверху.
    const times = body.timeline.map((item) => item.at)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('ПОЛНОГО КОДА ПОДАРКА В ОТВЕТЕ НЕТ — только последние четыре знака', async () => {
    const response = await card(own.guestId, ownerToken).expect(200)

    expect(JSON.stringify(response.body)).not.toContain(redeemedCode)
  })

  it('подарок с прошедшим сроком — «сгорел», даже если база ещё считает его выданным', async () => {
    const response = await card(own.guestId).expect(200)
    const gifts = (response.body as CardBody).timeline.filter((item) => item.kind === 'GIFT')

    expect(gifts.find((item) => item['grantId'] === expiredGrantId)).toMatchObject({
      state: 'EXPIRED',
    })
  })

  it('ПОДАРОК, ВЫДАННЫЙ СОСЕДОМ, В НАШЕЙ КАРТОЧКЕ НЕ ВИДЕН', async () => {
    const response = await card(own.guestId).expect(200)
    const body = response.body as CardBody

    expect(body.timeline.some((item) => item['grantId'] === neighbourGrantId)).toBe(false)
    expect(JSON.stringify(body)).not.toContain('Кофе от соседа')
  })

  it('средний чек — потрачено, делённое на визиты', async () => {
    const response = await card(own.guestId).expect(200)
    const body = response.body as CardBody

    expect(body.averageCheck).toBe(
      body.visitsTotal > 0 ? Math.floor(body.spentTotal / body.visitsTotal) : null,
    )
  })

  it('телефон — как в списке: маска менеджеру, целиком владельцу', async () => {
    const manager = await card(own.guestId).expect(200)
    const owner = await card(own.guestId, ownerToken).expect(200)

    expect((manager.body as CardBody).phone).toBe(
      `${own.guestPhone.slice(0, 3)} •• •• ${own.guestPhone.slice(-4)}`,
    )
    expect((owner.body as CardBody).phone).toBe(own.guestPhone)
  })

  it('название подарка — на языке того, кто смотрит', async () => {
    const response = await card(own.guestId, managerToken, '?locale=en').expect(200)
    const gifts = (response.body as CardBody).timeline.filter((item) => item.kind === 'GIFT')

    expect(gifts.find((item) => item['grantId'] === redeemedGrantId)).toMatchObject({
      title: 'Free dessert',
    })
  })

  it('ЧУЖОЙ ГОСТЬ — 404, как несуществующий', async () => {
    const stranger = await card(foreign.guestId).expect(404)
    const nobody = await card(randomUUID()).expect(404)

    expect((stranger.body as { error: { code: string } }).error.code).toBe(
      (nobody.body as { error: { code: string } }).error.code,
    )
  })

  it('кассиру карточка не положена — 403', async () => {
    await card(own.guestId, cashierToken).expect(403)
  })

  it('неизвестный язык — 400', async () => {
    await card(own.guestId, managerToken, '?locale=de').expect(400)
  })
})
