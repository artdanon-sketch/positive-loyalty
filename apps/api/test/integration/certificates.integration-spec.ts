import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { OfferGrantService } from '../../src/core/offer-grant.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, createTenant } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Шаблоны сертификатов и подарок по шаблону. docs/02, разделы 5.2.1 и 5.11 · docs/11, У9.
 *
 * Полигон: заведение с гостем и соседнее заведение со своим гостем. Сосед заводит
 * свой шаблон — ловушка: он настоящий, но нашему гостю его не подарить.
 */

const SECRET = 'certificates-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let grants: OfferGrantService
let tenantId: string
let guest: MembershipFixture
let neighbour: MembershipFixture
let ownerToken: string
let managerToken: string
let neighbourOwnerToken: string
let template: TemplateBody

const server = (): Server => app.getHttpServer() as Server

interface TemplateBody {
  id: string
  title: string
  value: unknown
  validityDays: number
  isActive: boolean
  issued: number
  redeemed: number
}

interface ErrorBody {
  error: { code: string }
}

const bearer = (token: string): string => `Bearer ${token}`

const createTemplate = (token: string, title: string) =>
  request(server())
    .post('/v1/admin/certificates')
    .set('Authorization', bearer(token))
    .send({ title, value: { kind: 'FIXED_OFF', amount: 50_000 }, validityDays: 30 })

const listTemplates = async (token: string = managerToken): Promise<TemplateBody[]> =>
  (await request(server()).get('/v1/admin/certificates').set('Authorization', bearer(token)))
    .body as TemplateBody[]

const gift = (token: string, guestId: string, body: Record<string, unknown>) =>
  request(server())
    .post(`/v1/admin/guests/${guestId}/gifts`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', `cert-${randomUUID()}`)
    .send(body)

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  grants = moduleRef.get(OfferGrantService)

  tenantId = await createTenant(prisma)
  guest = await createMembershipFixture(prisma, { tenantId })
  neighbour = await createMembershipFixture(prisma)

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
  neighbourOwnerToken = signAccessToken(
    { tenantId: neighbour.tenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
})

afterAll(async () => {
  await app.close()
})

describe('Шаблоны сертификатов', () => {
  it('ВЛАДЕЛЕЦ ЗАВОДИТ ШАБЛОН; МЕНЕДЖЕР ВИДИТ, НО ЗАВЕСТИ НЕ МОЖЕТ', async () => {
    const created = await createTemplate(ownerToken, 'Сертификат на 500 ฿')

    expect(created.status).toBe(201)
    template = created.body as TemplateBody
    expect(template).toMatchObject({
      title: 'Сертификат на 500 ฿',
      value: { kind: 'FIXED_OFF', amount: 50_000 },
      validityDays: 30,
      isActive: true,
      issued: 0,
      redeemed: 0,
    })

    expect((await listTemplates()).map((row) => row.id)).toEqual([template.id])
    expect((await createTemplate(managerToken, 'Десерт')).status).toBe(403)
  })

  it('ШАБЛОН — НЕ КАМПАНИЯ: В СПИСКЕ «АКЦИИ» ЕГО НЕТ', async () => {
    const offers = await request(server())
      .get('/v1/admin/offers')
      .set('Authorization', bearer(ownerToken))

    expect(offers.status).toBe(200)
    expect(JSON.stringify(offers.body)).not.toContain(template.id)
  })

  it('соседу наш шаблон не виден и не меняется', async () => {
    expect((await listTemplates(neighbourOwnerToken)).map((row) => row.id)).not.toContain(
      template.id,
    )

    const patched = await request(server())
      .patch(`/v1/admin/certificates/${template.id}`)
      .set('Authorization', bearer(neighbourOwnerToken))
      .send({ isActive: false })
    expect(patched.status).toBe(404)
  })
})

describe('Подарок по шаблону', () => {
  it('СЕРТИФИКАТ ИЗ КАРТОЧКИ: НАЗВАНИЕ И СРОК — ИЗ ШАБЛОНА, СЧЁТЧИКИ «ВЫДАНО / ИСПОЛЬЗОВАНО» РАСТУТ', async () => {
    const before = Date.now()
    const response = await gift(managerToken, guest.guestId, {
      certificateId: template.id,
      reason: 'CELEBRATION',
    })

    expect(response.status).toBe(201)
    const body = response.body as { grantId: string; title: string; expiresAt: string }
    expect(body.title).toBe('Сертификат на 500 ฿')

    const days = (new Date(body.expiresAt).getTime() - before) / (24 * 60 * 60 * 1000)
    expect(Math.round(days)).toBe(30)

    expect((await listTemplates())[0]).toMatchObject({ issued: 1, redeemed: 0 })

    const grant = await prisma.forTenant(tenantId, async (tx) =>
      tx.offerGrant.findFirstOrThrow({
        where: { id: body.grantId, tenantId },
        select: { code: true, offerId: true },
      }),
    )
    expect(grant.offerId).toBe(template.id)

    await grants.redeem({ code: grant.code, tenantId, now: new Date() })
    expect((await listTemplates())[0]).toMatchObject({ issued: 1, redeemed: 1 })
  })

  it('ЧУЖОЙ ИЛИ ВЫКЛЮЧЕННЫЙ ШАБЛОН — 404, А ПОДАРОК БЕЗ НАЗВАНИЯ И БЕЗ ШАБЛОНА — 400', async () => {
    const foreign = (await createTemplate(neighbourOwnerToken, 'Чужой сертификат'))
      .body as TemplateBody

    const cross = await gift(ownerToken, guest.guestId, {
      certificateId: foreign.id,
      reason: 'CELEBRATION',
    })
    expect(cross.status).toBe(404)
    expect((cross.body as ErrorBody).error.code).toBe('CERTIFICATE_NOT_FOUND')

    const switchedOff = await request(server())
      .patch(`/v1/admin/certificates/${template.id}`)
      .set('Authorization', bearer(ownerToken))
      .send({ isActive: false })
    expect(switchedOff.body).toMatchObject({ isActive: false, issued: 1 })

    const off = await gift(ownerToken, guest.guestId, {
      certificateId: template.id,
      reason: 'CELEBRATION',
    })
    expect(off.status).toBe(404)

    expect((await gift(ownerToken, guest.guestId, { reason: 'CELEBRATION' })).status).toBe(400)
  })

  it('обычный подарок с названием работает как раньше', async () => {
    const response = await gift(ownerToken, guest.guestId, {
      title: 'Десерт',
      reason: 'LONG_WAIT',
      validityDays: 7,
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ title: 'Десерт', replayed: false })
  })
})
