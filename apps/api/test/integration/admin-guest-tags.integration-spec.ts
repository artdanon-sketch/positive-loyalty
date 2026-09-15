import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'

/**
 * Теги гостей: справочник, теги на госте, фильтр списка. docs/02, раздел 5.2.5 · docs/11, У5.
 *
 * Каждый тест — своё заведение: справочник общий на заведение.
 */

const SECRET = 'admin-guest-tags-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService

interface TagBody {
  id: string
  name: string
  color: string
}

const server = (): Server => app.getHttpServer() as Server

const tokens = (tenantId: string) => ({
  owner: signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET),
  manager: signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET),
  cashier: signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET),
})

const createTag = async (token: string, body: object) =>
  request(server()).post('/v1/admin/tags').set('Authorization', `Bearer ${token}`).send(body)

const listTags = async (token: string): Promise<TagBody[]> =>
  (
    await request(server())
      .get('/v1/admin/tags')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  ).body as TagBody[]

const setTags = async (guestId: string, token: string, tagIds: string[]) =>
  request(server())
    .put(`/v1/admin/guests/${guestId}/tags`)
    .set('Authorization', `Bearer ${token}`)
    .send({ tagIds })

const cardTags = async (guestId: string, token: string): Promise<TagBody[]> =>
  (
    (
      await request(server())
        .get(`/v1/admin/guests/${guestId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { tags: TagBody[] }
  ).tags

const listByTag = async (tagId: string, token: string): Promise<string[]> =>
  (
    (
      await request(server())
        .get(`/v1/admin/guests?limit=100&tag=${tagId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as { items: Array<{ membershipId: string }> }
  ).items.map((row) => row.membershipId)

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Справочник тегов', () => {
  it('ЗАВЕСТИ, ПЕРЕИМЕНОВАТЬ, УДАЛИТЬ; ОДНОИМЁННЫЙ БЕЗ УЧЁТА РЕГИСТРА — 409; УДАЛЯЕТ ТОЛЬКО ВЛАДЕЛЕЦ; СОСЕДУ НЕ ВИДНО', async () => {
    const venue = await createTenant(prisma)
    const { owner, manager, cashier } = tokens(venue)

    const vip = await createTag(manager, { name: 'VIP', color: 'amber' })

    expect(vip.status).toBe(201)
    expect(vip.body).toMatchObject({ name: 'VIP', color: 'amber' })

    const duplicate = await createTag(manager, { name: 'vip' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toMatchObject({ error: { code: 'TAG_EXISTS' } })

    const blogger = await createTag(manager, { name: 'Блогер' })

    expect(blogger.body).toMatchObject({ color: 'slate' })

    const bloggerId = (blogger.body as TagBody).id
    const renamed = await request(server())
      .patch(`/v1/admin/tags/${bloggerId}`)
      .set('Authorization', `Bearer ${manager}`)
      .send({ name: 'Инфлюенсер', color: 'violet' })

    expect(renamed.body).toMatchObject({ name: 'Инфлюенсер', color: 'violet' })

    const remove = (token: string) =>
      request(server())
        .delete(`/v1/admin/tags/${bloggerId}`)
        .set('Authorization', `Bearer ${token}`)

    expect((await remove(manager)).status).toBe(403)
    expect((await remove(owner)).status).toBe(204)
    expect((await listTags(manager)).map((tag) => tag.name)).toEqual(['VIP'])

    expect(await listTags(tokens(await createTenant(prisma)).owner)).toEqual([])
    expect((await createTag(cashier, { name: 'Касса' })).status).toBe(403)
  })
})

describe('Теги на госте', () => {
  it('ТЕГИ СТАВЯТСЯ НАБОРОМ ЦЕЛИКОМ, ВИДНЫ В КАРТОЧКЕ И В ФИЛЬТРЕ СПИСКА; УДАЛЁННЫЙ ТЕГ СХОДИТ С ГОСТЯ', async () => {
    const guest = await createMembershipFixture(prisma)
    const { owner, manager } = tokens(guest.tenantId)
    const vip = (await createTag(owner, { name: 'VIP', color: 'amber' })).body as TagBody
    const allergy = (await createTag(owner, { name: 'Аллергия', color: 'rose' })).body as TagBody

    const both = await setTags(guest.guestId, manager, [vip.id, allergy.id])

    expect(both.status).toBe(200)
    expect((both.body as { tags: TagBody[] }).tags.map((tag) => tag.id).sort()).toEqual(
      [vip.id, allergy.id].sort(),
    )
    expect(await cardTags(guest.guestId, manager)).toHaveLength(2)
    expect(await listByTag(vip.id, manager)).toEqual([guest.membershipId])

    expect((await setTags(guest.guestId, manager, [allergy.id])).status).toBe(200)

    expect(await listByTag(vip.id, manager)).toEqual([])
    expect(await listByTag(allergy.id, manager)).toEqual([guest.membershipId])

    await request(server())
      .delete(`/v1/admin/tags/${allergy.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(204)

    expect(await cardTags(guest.guestId, manager)).toEqual([])
  })

  it('ЧУЖОЙ ТЕГ — 400 И НИЧЕГО НЕ МЕНЯЕТСЯ; ОДИН ТЕГ ДВАЖДЫ — 400; ЧУЖОЙ ГОСТЬ — 404; КАССИРУ — 403', async () => {
    const guest = await createMembershipFixture(prisma)
    const { owner, manager, cashier } = tokens(guest.tenantId)
    const vip = (await createTag(owner, { name: 'VIP' })).body as TagBody

    expect((await setTags(guest.guestId, manager, [vip.id])).status).toBe(200)

    const neighbour = await createTenant(prisma)
    const foreignTag = (await createTag(tokens(neighbour).owner, { name: 'Чужой' })).body as TagBody
    const foreign = await setTags(guest.guestId, manager, [foreignTag.id])

    expect(foreign.status).toBe(400)
    expect(foreign.body).toMatchObject({ error: { code: 'UNKNOWN_TAG' } })
    expect((await cardTags(guest.guestId, manager)).map((tag) => tag.id)).toEqual([vip.id])

    expect((await setTags(guest.guestId, manager, [vip.id, vip.id])).status).toBe(400)
    expect((await setTags(guest.guestId, tokens(neighbour).manager, [])).status).toBe(404)
    expect((await setTags(guest.guestId, cashier, [])).status).toBe(403)
  })
})
