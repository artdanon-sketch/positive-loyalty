import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, type MembershipFixture } from './ledger-test-context'

/**
 * Теги гостя на кассе. docs/02, раздел 3.7 · docs/03, раздел 4.
 *
 * Полигон: заведение с двумя тегами в справочнике и гостем. Настройка сначала
 * выключена — в этом состоянии касса о тегах не знает вовсе.
 *
 * Главное, что проверяется: пока владелец не разрешил, ни один тег на кассу
 * не уезжает. Среди тегов бывают «жалобщик» и «не давать скидку», а экран кассы
 * гость читает через плечо.
 */

const SECRET = 'pos-tags-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let guest: MembershipFixture
let tenantId: string
let ownerToken: string
let cashierToken: string
let allergyTagId: string
let complaintTagId: string

const server = (): Server => app.getHttpServer() as Server

interface GuestBody {
  membershipId: string
  tags: Array<{ id: string; name: string }>
}

const findGuest = async (): Promise<GuestBody> => {
  const response = await request(server())
    .get(`/v1/pos/guest?phone=${encodeURIComponent(guest.guestPhone)}`)
    .set('Authorization', `Bearer ${cashierToken}`)
    .expect(200)

  return response.body as GuestBody
}

const setRules = async (showGuestTags: boolean, allowTagging: boolean): Promise<void> => {
  await request(server())
    .put('/v1/admin/settings/program')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      baseEarnRate: 5,
      baseRedeemRate: 30,
      cashierRules: {
        requireReceiptNumber: false,
        maxManualAmount: null,
        allowManualEntry: true,
        showGuestTags,
        allowTagging,
      },
    })
    .expect(200)
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

  guest = await createMembershipFixture(prisma)
  tenantId = guest.tenantId

  const allergy = await prisma.tag.create({
    data: { tenantId, name: 'Аллергия на арахис' },
    select: { id: true },
  })
  const complaint = await prisma.tag.create({
    data: { tenantId, name: 'Жалобщик' },
    select: { id: true },
  })
  allergyTagId = allergy.id
  complaintTagId = complaint.id

  await prisma.guestTag.create({
    data: { tenantId, membershipId: guest.membershipId, tagId: complaintTagId },
  })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  cashierToken = signAccessToken({ tenantId, actorId: null, role: 'CASHIER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Теги на кассе: пока владелец не разрешил', () => {
  it('КАССА НЕ ВИДИТ НИ ОДНОГО ТЕГА ГОСТЯ', async () => {
    const body = await findGuest()

    expect(body.tags).toEqual([])
  })

  it('СПРАВОЧНИК НА КАССУ НЕ УЕЗЖАЕТ', async () => {
    const response = await request(server())
      .get('/v1/pos/config')
      .set('Authorization', `Bearer ${cashierToken}`)
      .expect(200)

    expect((response.body as { tags: unknown[] }).tags).toEqual([])
  })

  it('ПОВЕСИТЬ ТЕГ НЕЛЬЗЯ', async () => {
    const response = await request(server())
      .post(`/v1/pos/guest/${guest.membershipId}/tags`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ tagId: allergyTagId })

    expect(response.status).toBe(403)
  })
})

describe('Теги на кассе: показ включён', () => {
  it('ТЕГИ ГОСТЯ ВИДНЫ, А СПРАВОЧНИК — ЕЩЁ НЕТ: ВЕШАТЬ НЕ РАЗРЕШЕНО', async () => {
    await setRules(true, false)

    const body = await findGuest()
    expect(body.tags.map((tag) => tag.name)).toEqual(['Жалобщик'])

    const config = await request(server())
      .get('/v1/pos/config')
      .set('Authorization', `Bearer ${cashierToken}`)
      .expect(200)

    expect((config.body as { tags: unknown[] }).tags).toEqual([])
  })
})

describe('Теги на кассе: разрешено вешать', () => {
  it('КАССИР ВЕШАЕТ ТЕГ ИЗ СПРАВОЧНИКА, И ОН СРАЗУ ВИДЕН', async () => {
    await setRules(true, true)

    const response = await request(server())
      .post(`/v1/pos/guest/${guest.membershipId}/tags`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ tagId: allergyTagId })

    expect(response.status).toBe(200)
    expect((response.body as Array<{ name: string }>).map((tag) => tag.name)).toContain(
      'Аллергия на арахис',
    )
  })

  it('ПОВТОР НИЧЕГО НЕ МЕНЯЕТ: КАССИР НАЖАЛ ДВАЖДЫ, ГОСТЬ НЕ ИЗМЕНИЛСЯ', async () => {
    const response = await request(server())
      .post(`/v1/pos/guest/${guest.membershipId}/tags`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ tagId: allergyTagId })
      .expect(200)

    expect(response.body).toHaveLength(2)
  })

  it('ЧУЖОГО ТЕГА НЕТ В СПРАВОЧНИКЕ — ЗНАЧИТ ЕГО НЕТ ВОВСЕ', async () => {
    const stranger = await createMembershipFixture(prisma)
    const foreign = await prisma.tag.create({
      data: { tenantId: stranger.tenantId, name: 'Чужой тег' },
      select: { id: true },
    })

    const response = await request(server())
      .post(`/v1/pos/guest/${guest.membershipId}/tags`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ tagId: foreign.id })

    expect(response.status).toBe(404)
  })
})
