import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signGuestToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, type MembershipFixture } from './ledger-test-context'

/**
 * Профиль гостя: имя и язык. docs/02, раздел 2.12.
 *
 * Полигон: два гостя. Главное, что проверяется, — правка своей строки и только
 * своей: гостевой контур RLS не должен пускать чужое имя даже при подмене тела.
 */

const SECRET = 'guest-profile-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let mine: MembershipFixture
let other: MembershipFixture
let token: string

const server = (): Server => app.getHttpServer() as Server

const put = (body: Record<string, unknown>) =>
  request(server()).put('/v1/guest/me').set('Authorization', `Bearer ${token}`).send(body)

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)

  mine = await createMembershipFixture(prisma)
  other = await createMembershipFixture(prisma)

  await prisma.guest.update({
    where: { id: other.guestId },
    data: { displayName: 'Соседка', locale: 'en' },
  })

  token = signGuestToken({ guestId: mine.guestId }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Профиль гостя', () => {
  it('ГОСТЬ МЕНЯЕТ ИМЯ И ЯЗЫК', async () => {
    const response = await put({ displayName: 'Анна', locale: 'en' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ displayName: 'Анна', locale: 'en' })
  })

  it('ПУСТОЕ ИМЯ — ЭТО «НЕ ПРЕДСТАВИЛСЯ», И ОНО СОХРАНЯЕТСЯ', async () => {
    const response = await put({ displayName: null, locale: 'ru' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ displayName: null, locale: 'ru' })
  })

  it('«ТУРИСТ ИЛИ РЕЗИДЕНТ» ЧЕРЕЗ ПРОФИЛЬ НЕ МЕНЯЕТСЯ', async () => {
    const response = await put({ displayName: 'Анна', locale: 'ru', mode: 'RESIDENT' })

    expect(response.status).toBe(400)
  })

  it('ЧУЖОЙ ПРОФИЛЬ НЕ ТРОНУТ — ДАЖЕ СОСЕДНЯЯ СТРОКА В ТОЙ ЖЕ ТАБЛИЦЕ', async () => {
    await put({ displayName: 'Анна', locale: 'th' }).expect(200)

    const neighbour = await prisma.guest.findUnique({
      where: { id: other.guestId },
      select: { displayName: true, locale: true },
    })

    expect(neighbour).toMatchObject({ displayName: 'Соседка', locale: 'en' })
  })

  it('БЕЗ ТОКЕНА ГОСТЯ ПРОФИЛЬ НЕ МЕНЯЕТСЯ', async () => {
    const response = await request(server())
      .put('/v1/guest/me')
      .send({ displayName: 'Кто угодно', locale: 'ru' })

    expect(response.status).toBe(401)
  })
})
