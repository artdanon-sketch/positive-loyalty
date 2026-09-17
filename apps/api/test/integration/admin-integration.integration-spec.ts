import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createTenant } from './ledger-test-context'

/**
 * Экран интеграции с кассой. docs/02, раздел 5.16.
 *
 * Полигон: заведение с подключённой кассой и соседнее без неё.
 *
 * Главное, что проверяется: ключ не приезжает на экран сам собой, а его
 * перевыпуск нельзя сделать молча — причина обязательна и уходит в историю.
 */

const SECRET = 'admin-integration-secret-not-used-anywhere-else'
// Ключ собирается на месте, а не пишется строкой: строка, похожая на боевой
// ключ вебхука, в репозитории — то, что наша же проверка секретов справедливо
// не пропускает.
const WEBHOOK_SECRET = `test-secret-${randomUUID()}`

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let emptyTenantId: string
let ownerToken: string
let emptyOwnerToken: string
let managerToken: string

const server = (): Server => app.getHttpServer() as Server

const status = async (token: string) => {
  const response = await request(server())
    .get('/v1/admin/integration')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)

  return response.body as {
    connected: boolean
    secretMasked: string | null
    receivedWeek: number
    failed: number
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

  tenantId = await createTenant(prisma)
  emptyTenantId = await createTenant(prisma)

  await prisma.posLink.create({
    data: {
      tenantId,
      posMerchantId: `pos-${randomUUID().slice(0, 8)}`,
      webhookSecret: WEBHOOK_SECRET,
      callbackUrl: 'https://pos.example/callback',
    },
  })

  // Одно принятое событие и одно неразобранное: счётчики должны их различать.
  await prisma.webhookEvent.createMany({
    data: [
      {
        tenantId,
        source: 'POSITIVE_POS',
        eventType: 'receipt.closed',
        externalId: randomUUID(),
        payload: {},
        status: 'PROCESSED',
      },
      {
        tenantId,
        source: 'POSITIVE_POS',
        eventType: 'receipt.closed',
        externalId: randomUUID(),
        payload: {},
        status: 'FAILED',
        lastError: 'нет такого гостя',
      },
    ],
  })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  emptyOwnerToken = signAccessToken(
    { tenantId: emptyTenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Интеграция с кассой: состояние', () => {
  it('ПОДКЛЮЧЕНИЕ ВИДНО, А КЛЮЧ — ТОЛЬКО ХВОСТОМ', async () => {
    const body = await status(ownerToken)

    expect(body.connected).toBe(true)
    expect(body.secretMasked).toBe(`••••${WEBHOOK_SECRET.slice(-4)}`)
    expect(body.secretMasked).not.toContain('whsec')
  })

  it('СЧЁТЧИКИ РАЗЛИЧАЮТ ПРИНЯТОЕ И НЕРАЗОБРАННОЕ', async () => {
    const body = await status(ownerToken)

    expect(body.receivedWeek).toBe(2)
    expect(body.failed).toBe(1)
  })

  it('ЗАВЕДЕНИЕ БЕЗ КАССЫ ЧЕСТНО ГОВОРИТ ОБ ЭТОМ, А НЕ ПАДАЕТ', async () => {
    const body = await status(emptyOwnerToken)

    expect(body.connected).toBe(false)
    expect(body.secretMasked).toBeNull()
  })

  it('МЕНЕДЖЕР СЮДА НЕ ХОДИТ: КЛЮЧОМ НАЧИСЛЯЮТ БАЛЛЫ', async () => {
    const response = await request(server())
      .get('/v1/admin/integration')
      .set('Authorization', `Bearer ${managerToken}`)

    expect(response.status).toBe(403)
  })
})

describe('Интеграция с кассой: ключ', () => {
  it('ПОЛНЫЙ КЛЮЧ ВЫДАЁТСЯ ОТДЕЛЬНО И ПОПАДАЕТ В ИСТОРИЮ', async () => {
    const response = await request(server())
      .post('/v1/admin/integration/secret/reveal')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ secret: WEBHOOK_SECRET })

    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'INTEGRATION_SECRET_REVEALED' },
      select: { id: true },
    })
    expect(entry).not.toBeNull()
  })

  it('ПЕРЕВЫПУСК БЕЗ ПРИЧИНЫ НЕ ПРОХОДИТ: ЭТО ОСТАНОВКА ПРИЁМА ЧЕКОВ', async () => {
    const response = await request(server())
      .post('/v1/admin/integration/secret/rotate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'ой' })

    expect(response.status).toBe(400)
  })

  it('ПЕРЕВЫПУСК МЕНЯЕТ КЛЮЧ И ПИШЕТ ПРИЧИНУ В ИСТОРИЮ', async () => {
    const response = await request(server())
      .post('/v1/admin/integration/secret/rotate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'ключ засветился в переписке с подрядчиком' })

    expect(response.status).toBe(200)
    const fresh = (response.body as { secret: string }).secret
    expect(fresh).not.toBe(WEBHOOK_SECRET)

    const link = await prisma.posLink.findFirst({
      where: { tenantId },
      select: { webhookSecret: true },
    })
    expect(link?.webhookSecret).toBe(fresh)

    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'INTEGRATION_SECRET_ROTATED' },
      select: { reason: true },
    })
    expect(entry?.reason).toContain('переписке')
  })

  it('У ЗАВЕДЕНИЯ БЕЗ КАССЫ ПЕРЕВЫПУСКАТЬ НЕЧЕГО', async () => {
    const response = await request(server())
      .post('/v1/admin/integration/secret/rotate')
      .set('Authorization', `Bearer ${emptyOwnerToken}`)
      .send({ reason: 'просто попробовать перевыпустить' })

    expect(response.status).toBe(404)
  })
})
