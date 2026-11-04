import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { signWebhookBody } from '../../src/integrations/webhook-signature'

import { createTenant } from './ledger-test-context'

/**
 * Подключение кассы и её вход. docs/02, разделы 3.10 и 5.16.
 *
 * Главное здесь — граница: токен кассы даёт ровно `/v1/pos/*` и ровно своего
 * заведения, а ключ соседа токена не даёт.
 */

const SECRET = 'pos-link-secret-not-used-anywhere-else-123456'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let otherTenantId: string
let ownerToken: string
let otherOwnerToken: string
let managerToken: string

const server = (): Server => app.getHttpServer() as Server

const connect = async (token: string) =>
  request(server()).post('/v1/admin/integration/connect').set('Authorization', `Bearer ${token}`)

const askToken = async (posMerchantId: string, secret: string) => {
  const body = JSON.stringify({ posMerchantId })
  const timestamp = Math.floor(Date.now() / 1000)

  return request(server())
    .post('/v1/webhooks/pos/token')
    .set('Content-Type', 'application/json')
    .set('X-Positive-Signature', signWebhookBody(Buffer.from(body), secret, timestamp))
    .set('X-Positive-Timestamp', String(timestamp))
    .send(body)
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication({ rawBody: true })
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)

  tenantId = await createTenant(prisma)
  otherTenantId = await createTenant(prisma)

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  otherOwnerToken = signAccessToken(
    { tenantId: otherTenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('подключение кассы', () => {
  it('менеджеру нельзя: ключ начисляет баллы от имени заведения', async () => {
    const response = await connect(managerToken)

    expect(response.status).toBe(403)
  })

  it('владелец получает идентификатор и ключ, второй раз — отказ', async () => {
    const first = await connect(ownerToken)

    expect(first.status).toBe(200)
    expect(first.body.posMerchantId).toMatch(/^pm_/)
    expect(first.body.secret.length).toBeGreaterThanOrEqual(32)

    const second = await connect(ownerToken)

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ALREADY_CONNECTED')

    const links = await prisma.posLink.count({ where: { tenantId } })

    expect(links).toBe(1)
  })
})

describe('токен сервера кассы', () => {
  let merchantId: string
  let secret: string

  beforeAll(async () => {
    const link = await prisma.posLink.findFirstOrThrow({ where: { tenantId } })

    merchantId = link.posMerchantId
    secret = link.webhookSecret
  })

  it('подпись ключом связки даёт токен, и он пускает на кассу', async () => {
    const issued = await askToken(merchantId, secret)

    expect(issued.status).toBe(200)
    expect(issued.body.expiresIn).toBe(600)

    await request(server())
      .get('/v1/pos/config')
      .set('Authorization', `Bearer ${issued.body.accessToken}`)
      .expect(200)
  })

  it('этот токен не открывает бэк-офис', async () => {
    const issued = await askToken(merchantId, secret)

    await request(server())
      .get('/v1/admin/integration')
      .set('Authorization', `Bearer ${issued.body.accessToken}`)
      .expect(403)
  })

  it('чужой ключ и неизвестный идентификатор — один и тот же отказ', async () => {
    const wrongKey = await askToken(merchantId, `wrong-${randomUUID()}`)
    const unknown = await askToken(`pm_${randomUUID()}`, secret)

    expect(wrongKey.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrongKey.body.error.code).toBe(unknown.body.error.code)
  })

  it('ключ соседа не даёт токена на наше заведение', async () => {
    const neighbour = await connect(otherOwnerToken)

    const response = await askToken(merchantId, neighbour.body.secret as string)

    expect(response.status).toBe(401)
  })

  it('без подписи — отказ', async () => {
    await request(server())
      .post('/v1/webhooks/pos/token')
      .send({ posMerchantId: merchantId })
      .expect(401)
  })
})
