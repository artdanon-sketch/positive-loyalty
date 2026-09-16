import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createLedgerTestContext,
  createMembershipFixture,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Новости заведения. docs/02, разделы 2.9 и 5.14 · docs/11, У13.
 *
 * Полигон: заведение с гостем, соседнее заведение со своим гостем и гость без участий.
 * HTTP-проверки ходят владельцем базы, которого RLS не касается, — политики `News`
 * проверены отдельно, под ролью приложения (последний блок).
 */

const SECRET = 'news-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let venue: MembershipFixture
let neighbour: MembershipFixture
let strangerId: string
let venueName: string
let ownerToken: string
let managerToken: string
let neighbourOwnerToken: string
let newsId: string
let firstPublishedAt: string

const server = (): Server => app.getHttpServer() as Server
const bearer = (token: string): string => `Bearer ${token}`

interface NewsBody {
  id: string
  title: string
  isPublished: boolean
  publishedAt: string | null
}

interface GuestNewsBody {
  items: Array<{ id: string; venue: string; title: string; publishedAt: string }>
}

const guestNews = async (guestId: string): Promise<GuestNewsBody> =>
  (
    await request(server())
      .get('/v1/guest/news')
      .set('Authorization', bearer(signGuestToken({ guestId }, SECRET)))
  ).body as GuestNewsBody

const patch = (token: string, id: string, body: Record<string, unknown>) =>
  request(server()).patch(`/v1/admin/news/${id}`).set('Authorization', bearer(token)).send(body)

/** Настоящий PrismaService под ролью приложения — приём из ledger-app-role. */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const url = process.env['DATABASE_URL_TEST_APP_ROLE']

  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Не задан DATABASE_URL_TEST_APP_ROLE — политики News не проверить.')
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

  venue = await createMembershipFixture(prisma)
  neighbour = await createMembershipFixture(prisma)
  strangerId = (await prisma.guest.create({ data: { locale: 'ru' }, select: { id: true } })).id
  venueName = (
    await prisma.tenant.findUniqueOrThrow({
      where: { id: venue.tenantId },
      select: { brandName: true },
    })
  ).brandName

  const sign = (tenantId: string, role: string): string =>
    signAccessToken({ tenantId, actorId: null, role }, SECRET)

  ownerToken = sign(venue.tenantId, 'OWNER')
  managerToken = sign(venue.tenantId, 'MANAGER')
  neighbourOwnerToken = sign(neighbour.tenantId, 'OWNER')
})

afterAll(async () => {
  await app.close()
})

describe('Новости: публикация', () => {
  it('ЧЕРНОВИК ГОСТЮ НЕ ВИДЕН; ОПУБЛИКОВАННАЯ НОВОСТЬ — В ЛЕНТЕ С ИМЕНЕМ ЗАВЕДЕНИЯ', async () => {
    const created = await request(server())
      .post('/v1/admin/news')
      .set('Authorization', bearer(ownerToken))
      .send({ title: 'Новое меню', body: 'С понедельника — суп дня.' })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      title: 'Новое меню',
      isPublished: false,
      publishedAt: null,
    })
    newsId = (created.body as NewsBody).id

    expect((await guestNews(venue.guestId)).items.map((item) => item.id)).not.toContain(newsId)

    const published = await patch(ownerToken, newsId, { isPublished: true })
    expect(published.status).toBe(200)
    firstPublishedAt = (published.body as NewsBody).publishedAt ?? ''
    expect(firstPublishedAt).not.toBe('')

    expect((await guestNews(venue.guestId)).items[0]).toMatchObject({
      id: newsId,
      venue: venueName,
      title: 'Новое меню',
    })
  })

  it('ГОСТЬ БЕЗ УЧАСТИЯ И ГОСТЬ СОСЕДНЕГО ЗАВЕДЕНИЯ ЧУЖИХ НОВОСТЕЙ НЕ ВИДЯТ', async () => {
    expect((await guestNews(strangerId)).items).toEqual([])
    expect((await guestNews(neighbour.guestId)).items.map((item) => item.id)).not.toContain(newsId)
  })

  it('СНЯТА И ВЫПУЩЕНА СНОВА — ДАТА ПЕРВОЙ ПУБЛИКАЦИИ НЕ МЕНЯЕТСЯ', async () => {
    await patch(ownerToken, newsId, { isPublished: false })
    expect((await guestNews(venue.guestId)).items.map((item) => item.id)).not.toContain(newsId)

    const again = await patch(ownerToken, newsId, { isPublished: true, title: 'Новое меню!' })
    expect(again.body).toMatchObject({ isPublished: true, publishedAt: firstPublishedAt })
  })
})

describe('Новости: просмотры', () => {
  const seen = (guestId: string, ids: readonly string[]) =>
    request(server())
      .post('/v1/guest/news/seen')
      .set('Authorization', bearer(signGuestToken({ guestId }, SECRET)))
      .send({ ids })

  const views = async (): Promise<number> => {
    const list = (
      await request(server()).get('/v1/admin/news').set('Authorization', bearer(ownerToken))
    ).body as Array<NewsBody & { views: number }>

    return list.find((item) => item.id === newsId)?.views ?? -1
  }

  it('ГОСТЬ СЧИТАЕТСЯ ОДИН РАЗ, СКОЛЬКО БЫ НИ ОТКРЫВАЛ; ЧУЖОЙ НЕ СЧИТАЕТСЯ ВОВСЕ', async () => {
    const first = await seen(venue.guestId, [newsId])
    expect(first.status).toBe(201)
    expect(first.body).toEqual({ counted: 1 })
    expect(await views()).toBe(1)

    // Открыл карту ещё раз — просмотр тот же человек, число не растёт.
    expect((await seen(venue.guestId, [newsId])).body).toEqual({ counted: 0 })
    expect(await views()).toBe(1)

    // Гость без участия в заведении новость не видит — и отметить её не может.
    expect((await seen(strangerId, [newsId])).body).toEqual({ counted: 0 })
    expect((await seen(neighbour.guestId, [newsId])).body).toEqual({ counted: 0 })
    expect(await views()).toBe(1)
  })

  it('ПУСТОЙ СПИСОК И НЕ ИДЕНТИФИКАТОРЫ — 400', async () => {
    expect((await seen(venue.guestId, [])).status).toBe(400)
    expect((await seen(venue.guestId, ['всё'])).status).toBe(400)
  })
})

describe('Новости: права', () => {
  it('МЕНЕДЖЕР ВИДИТ СПИСОК, НО НЕ ПИШЕТ; ЧУЖУЮ НОВОСТЬ НЕ ИЗМЕНИТЬ; ПУСТАЯ ПРАВКА — 400', async () => {
    const list = await request(server())
      .get('/v1/admin/news')
      .set('Authorization', bearer(managerToken))
    expect(list.status).toBe(200)
    expect((list.body as NewsBody[]).map((item) => item.id)).toContain(newsId)

    const write = await request(server())
      .post('/v1/admin/news')
      .set('Authorization', bearer(managerToken))
      .send({ title: 'Скидка', body: 'Только сегодня' })
    expect(write.status).toBe(403)

    expect((await patch(neighbourOwnerToken, newsId, { isPublished: false })).status).toBe(404)
    expect((await patch(ownerToken, newsId, {})).status).toBe(400)

    const short = await request(server())
      .post('/v1/admin/news')
      .set('Authorization', bearer(ownerToken))
      .send({ title: 'Н', body: 'Текст' })
    expect(short.status).toBe(400)
  })
})

describe('Новости: политики RLS под ролью приложения', () => {
  let appRole: LedgerTestContext

  beforeAll(async () => {
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    await appRole?.close()
  })

  it('ОПУБЛИКОВАННУЮ ВИДЯТ ЕЁ ЗАВЕДЕНИЕ И ЕГО ГОСТЬ; ПОСТОРОННИЙ, СОСЕДИ И ЧЕРНОВИК — НЕТ', async () => {
    const find = { where: { id: newsId }, select: { id: true } } as const

    expect(await appRole.prisma.news.findMany(find)).toEqual([])
    expect(
      await appRole.prisma.forTenant(venue.tenantId, async (tx) => tx.news.findMany(find)),
    ).toEqual([{ id: newsId }])
    expect(
      await appRole.prisma.forGuest(venue.guestId, async (tx) => tx.news.findMany(find)),
    ).toEqual([{ id: newsId }])
    expect(await appRole.prisma.forGuest(strangerId, async (tx) => tx.news.findMany(find))).toEqual(
      [],
    )
    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) => tx.news.findMany(find)),
    ).toEqual([])

    const draft = await prisma.news.create({
      data: { tenantId: venue.tenantId, title: 'Черновик', body: 'Пока не для гостей' },
      select: { id: true },
    })
    expect(
      await appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.news.findMany({ where: { id: draft.id }, select: { id: true } }),
      ),
    ).toEqual([])
  })

  it('ПРОСМОТР ГОСТЬ СТАВИТ ТОЛЬКО ЗА СЕБЯ И ТОЛЬКО НА ВИДИМУЮ НОВОСТЬ', async () => {
    const draft = await prisma.news.create({
      data: { tenantId: venue.tenantId, title: 'Ещё черновик', body: 'Не для гостей' },
      select: { id: true },
    })

    // За другого гостя — политика не пускает.
    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.newsView.create({
          data: { tenantId: venue.tenantId, newsId, guestId: neighbour.guestId },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)

    // На черновик — тоже: вложенный SELECT по News идёт под гостевой политикой.
    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.newsView.create({
          data: { tenantId: venue.tenantId, newsId: draft.id, guestId: venue.guestId },
        }),
      ),
    ).rejects.toThrow(/row-level security/i)

    // Соседнее заведение чужих просмотров не считает.
    expect(
      await appRole.prisma.forTenant(neighbour.tenantId, async (tx) =>
        tx.newsView.findMany({ where: { newsId }, select: { id: true } }),
      ),
    ).toEqual([])
  })

  it('ГОСТЬ НЕ ПИШЕТ И НЕ МЕНЯЕТ НОВОСТИ', async () => {
    const changed = await appRole.prisma.forGuest(venue.guestId, async (tx) =>
      tx.news.updateMany({ where: { id: newsId }, data: { title: 'Взлом' } }),
    )
    expect(changed.count).toBe(0)

    await expect(
      appRole.prisma.forGuest(venue.guestId, async (tx) =>
        tx.news.create({ data: { tenantId: venue.tenantId, title: 'Спам', body: 'Спам' } }),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
