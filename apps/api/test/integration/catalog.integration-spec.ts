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
  createMembershipFixture,
  idempotencyKey,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Каталог товаров и услуг. docs/02, разделы 5.17 и 2.13.
 *
 * Полигон: заведение с тремя позициями — за баллы, дорогая за баллы и без цены
 * в баллах вовсе; у гостя 500 баллов. Соседнее заведение со своей позицией.
 *
 * Главное, что проверяется: гость видит только то, что можно взять за баллы,
 * и только у своих заведений.
 */

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService
let guest: MembershipFixture
let stranger: MembershipFixture
let ownerToken: string
let guestToken: string

const server = (): Server => app.getHttpServer() as Server

const create = (body: Record<string, unknown>) =>
  request(server())
    .post('/v1/admin/catalog')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send(body)

interface GuestItem {
  name: string
  pointsPrice: number
  affordable: boolean
  venue: string
}

const guestCatalog = async (): Promise<GuestItem[]> => {
  const response = await request(server())
    .get('/v1/guest/catalog')
    .set('Authorization', `Bearer ${guestToken}`)
    .expect(200)

  return (response.body as { items: GuestItem[] }).items
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = 'catalog-secret-not-used-anywhere-else'

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)

  guest = await createMembershipFixture(prisma)
  stranger = await createMembershipFixture(prisma)

  await ledger.earn(
    {
      membershipId: guest.membershipId,
      amount: 500,
      basisAmount: 100_000,
      idempotencyKey: idempotencyKey('catalog'),
      source: 'STAFF_MANUAL',
      actorType: 'STAFF',
      actorId: undefined,
    },
    guest.scope,
  )

  await prisma.catalogItem.create({
    data: { tenantId: stranger.tenantId, name: 'Чужой кофе', pointsPrice: 100 },
  })

  ownerToken = signAccessToken(
    { tenantId: guest.tenantId, actorId: null, role: 'OWNER' },
    'catalog-secret-not-used-anywhere-else',
  )
  guestToken = signGuestToken({ guestId: guest.guestId }, 'catalog-secret-not-used-anywhere-else')
})

afterAll(async () => {
  await app.close()
})

describe('Каталог: владелец', () => {
  it('ДОБАВЛЯЕТ ПОЗИЦИИ — С ЦЕНОЙ В БАЛЛАХ И БЕЗ НЕЁ', async () => {
    await create({ name: 'Кофе в подарок', pointsPrice: 300, sortOrder: 0 }).expect(201)
    await create({ name: 'Сет на двоих', pointsPrice: 5000, sortOrder: 1 }).expect(201)
    const plain = await create({ name: 'Паста', priceMinor: 32_000, sortOrder: 2 })

    expect(plain.status).toBe(201)
    expect(plain.body).toMatchObject({ pointsPrice: null, isActive: true })
  })

  it('КАРТИНКА ПО HTTP НЕ ПРИНИМАЕТСЯ — КАК И В НОВОСТЯХ', async () => {
    const response = await create({ name: 'Торт', imageUrl: 'http://cdn.example/cake.jpg' })

    expect(response.status).toBe(400)
  })

  it('ВИДИТ СВОЙ КАТАЛОГ В ПОРЯДКЕ ВИТРИНЫ', async () => {
    const response = await request(server())
      .get('/v1/admin/catalog')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const names = (response.body as Array<{ name: string }>).map((item) => item.name)
    expect(names.slice(0, 3)).toEqual(['Кофе в подарок', 'Сет на двоих', 'Паста'])
    expect(names).not.toContain('Чужой кофе')
  })
})

describe('Каталог: гость', () => {
  it('ВИДИТ ТОЛЬКО ТО, ЧТО МОЖНО ВЗЯТЬ ЗА БАЛЛЫ', async () => {
    const items = await guestCatalog()

    expect(items.map((item) => item.name)).toEqual(['Кофе в подарок', 'Сет на двоих'])
  })

  it('«ХВАТАЕТ ИЛИ НЕТ» СЧИТАЕМ МЫ, А НЕ ЭКРАН', async () => {
    const items = await guestCatalog()

    expect(items.find((item) => item.name === 'Кофе в подарок')?.affordable).toBe(true)
    expect(items.find((item) => item.name === 'Сет на двоих')?.affordable).toBe(false)
  })

  it('ЧУЖИХ ЗАВЕДЕНИЙ В ВИТРИНЕ НЕТ', async () => {
    const items = await guestCatalog()

    expect(items.some((item) => item.name === 'Чужой кофе')).toBe(false)
  })

  it('СНЯТАЯ С ВИТРИНЫ ПОЗИЦИЯ ИСЧЕЗАЕТ У ГОСТЯ, НО ОСТАЁТСЯ У ВЛАДЕЛЬЦА', async () => {
    const owned = await prisma.catalogItem.findFirst({
      where: { tenantId: guest.tenantId, name: 'Кофе в подарок' },
      select: { id: true },
    })

    await request(server())
      .patch(`/v1/admin/catalog/${owned?.id ?? ''}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false })
      .expect(200)

    const items = await guestCatalog()
    expect(items.some((item) => item.name === 'Кофе в подарок')).toBe(false)

    const mine = await request(server())
      .get('/v1/admin/catalog')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    expect(
      (mine.body as Array<{ name: string }>).some((item) => item.name === 'Кофе в подарок'),
    ).toBe(true)
  })
})
