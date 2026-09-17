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
 * Профиль заведения. docs/02, раздел 5.6.7.
 *
 * Главное, что проверяется: сохранение профиля НЕ ТРОГАЕТ настройки программы.
 * Они лежат в том же JSON, и перезапись целиком стёрла бы проценты начисления
 * одним нажатием «Сохранить» на другом экране.
 */

const SECRET = 'tenant-profile-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let ownerToken: string
let managerToken: string

const server = (): Server => app.getHttpServer() as Server

const put = (token: string, body: Record<string, unknown>) =>
  request(server())
    .put('/v1/admin/settings/profile')
    .set('Authorization', `Bearer ${token}`)
    .send(body)

const valid = {
  brandName: 'Kata Beach Kitchen',
  legalName: 'Kata Kitchen Co., Ltd.',
  vertical: 'RESTAURANT',
  timezone: 'Asia/Bangkok',
  locale: 'th',
  about: 'Кухня у моря, сет на двоих и кофе с видом.',
  phone: '+66 76 123 456',
  website: 'https://kata.example',
  address: 'Kata Rd 12, Phuket',
  hours: 'ежедневно 9:00–22:00',
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

  // Настройки программы, которые профиль не имеет права затереть.
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { baseEarnRate: 7, baseRedeemRate: 30 } },
  })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Профиль заведения', () => {
  it('НЕЗАПОЛНЕННЫЙ ПРОФИЛЬ ЧИТАЕТСЯ ПУСТЫМ, А НЕ ОШИБКОЙ', async () => {
    const response = await request(server())
      .get('/v1/admin/settings/profile')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ about: '', phone: null, timezone: 'Asia/Bangkok' })
  })

  it('ВЛАДЕЛЕЦ СОХРАНЯЕТ ПРОФИЛЬ ЦЕЛИКОМ', async () => {
    const response = await put(ownerToken, valid)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      brandName: 'Kata Beach Kitchen',
      hours: 'ежедневно 9:00–22:00',
      website: 'https://kata.example',
    })
  })

  it('НАСТРОЙКИ ПРОГРАММЫ ОСТАЛИСЬ НА МЕСТЕ — ЭТО ГЛАВНОЕ', async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, brandName: true },
    })

    expect(tenant?.settings).toMatchObject({ baseEarnRate: 7, baseRedeemRate: 30 })
    expect(tenant?.brandName).toBe('Kata Beach Kitchen')
  })

  it('НЕИЗВЕСТНЫЙ ЧАСОВОЙ ПОЯС НЕ ПРОХОДИТ: ОН ДВИГАЕТ ГРАНИЦУ СУТОК В ОТЧЁТАХ', async () => {
    const response = await put(ownerToken, { ...valid, timezone: 'Asia/Phuket' })

    expect(response.status).toBe(400)
  })

  it('МЕНЕДЖЕР ПРОФИЛЬ НЕ МЕНЯЕТ', async () => {
    const response = await put(managerToken, { ...valid, brandName: 'Чужое имя' })

    expect(response.status).toBe(403)

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandName: true },
    })
    expect(tenant?.brandName).toBe('Kata Beach Kitchen')
  })

  it('ИЗМЕНЕНИЕ ПОПАЛО В ИСТОРИЮ ВМЕСТЕ С ПОЯСОМ', async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'TENANT_PROFILE_CHANGED' },
      orderBy: { occurredAt: 'desc' },
      select: { newValue: true },
    })

    expect(entry?.newValue).toMatchObject({ timezone: 'Asia/Bangkok' })
  })
})
