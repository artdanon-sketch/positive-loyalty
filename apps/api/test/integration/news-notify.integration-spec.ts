import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, type MembershipFixture } from './ledger-test-context'

/**
 * Новости: картинка и уведомление гостям. docs/02, раздел 5.14.
 *
 * Главное, что проверяется: «сообщить гостям» создаёт ОБЫЧНУЮ рассылку, а не
 * второй путь отправки. Иначе правило «не больше четырёх сообщений в месяц»
 * считалось бы только по одному из двух, и гость получал бы вдвое больше.
 */

const SECRET = 'news-notify-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let guest: MembershipFixture
let tenantId: string
let ownerToken: string
let guestToken: string

const server = (): Server => app.getHttpServer() as Server

const createNews = (body: Record<string, unknown>) =>
  request(server()).post('/v1/admin/news').set('Authorization', `Bearer ${ownerToken}`).send(body)

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)

  guest = await createMembershipFixture(prisma)
  tenantId = guest.tenantId

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  guestToken = signGuestToken({ guestId: guest.guestId }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Новости: картинка', () => {
  it('ССЫЛКА СОХРАНЯЕТСЯ И ПРИЕЗЖАЕТ ГОСТЮ', async () => {
    const created = await createNews({
      title: 'Новое меню',
      body: 'С понедельника — суп дня.',
      publish: true,
      imageUrl: 'https://cdn.example/soup.jpg',
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ imageUrl: 'https://cdn.example/soup.jpg' })

    const feed = await request(server())
      .get('/v1/guest/news')
      .set('Authorization', `Bearer ${guestToken}`)
      .expect(200)

    const items = (feed.body as { items: Array<{ title: string; imageUrl: string | null }> }).items
    expect(items.find((item) => item.title === 'Новое меню')?.imageUrl).toBe(
      'https://cdn.example/soup.jpg',
    )
  })

  it('КАРТИНКА ПО HTTP НЕ ПРИНИМАЕТСЯ: БРАУЗЕР ГОСТЯ ЕЁ ВСЁ РАВНО ЗАБЛОКИРУЕТ', async () => {
    const response = await createNews({
      title: 'Плохая ссылка',
      body: 'Текст',
      imageUrl: 'http://cdn.example/soup.jpg',
    })

    expect(response.status).toBe(400)
  })

  it('БЕЗ КАРТИНКИ — НОРМА', async () => {
    const response = await createNews({ title: 'Просто новость', body: 'Текст' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ imageUrl: null })
  })
})

describe('Новости: сообщить гостям', () => {
  it('СОЗДАЁТ ОБЫЧНУЮ РАССЫЛКУ, А НЕ ВТОРОЙ ПУТЬ ОТПРАВКИ', async () => {
    const before = await prisma.broadcast.count({ where: { tenantId } })

    await createNews({
      title: 'Скидка на завтраки',
      body: 'Всю неделю −20%.',
      publish: true,
      notify: true,
    }).expect(201)

    const broadcasts = await prisma.broadcast.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { title: true, text: true },
    })

    expect(broadcasts).toHaveLength(before + 1)
    expect(broadcasts[0]?.title).toBe('Новость: Скидка на завтраки')
    expect(broadcasts[0]?.text).toContain('Всю неделю −20%.')
  })

  it('ЧЕРНОВИК НИКОМУ НЕ СООБЩАЕТ: РАССЫЛКА УЙДЁТ ПРИ ПУБЛИКАЦИИ, НЕ РАНЬШЕ', async () => {
    const before = await prisma.broadcast.count({ where: { tenantId } })

    await createNews({
      title: 'Черновик',
      body: 'Ещё не готово',
      publish: false,
      notify: true,
    }).expect(201)

    expect(await prisma.broadcast.count({ where: { tenantId } })).toBe(before)
  })
})
