import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { resolve } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

/**
 * Миграция 20261012120000_tenant_ids_to_uuid.
 *
 * До 12.10.2026 provision.ts заводил заведение с id-словом («kefir») и владельца
 * с id «kefir-owner», а вход давал устройством «owner-kefir». Так на бою живут
 * три заведения. Остальная система считает эти id UUID: гость не мог вступить
 * в программу, журнал отказывал в начислении. Миграция переводит их на UUID;
 * здесь заведение заводится ровно так, как его заводил старый provision.ts.
 */

const SECRET = 'tenant-uuid-migration-secret-not-used-anywhere-else'
const PIN = '5072'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Тесты API запускаются из apps/api: миграции лежат двумя уровнями выше.
const MIGRATION = readFileSync(
  resolve(process.cwd(), '../../prisma/migrations/20261012120000_tenant_ids_to_uuid/migration.sql'),
  'utf8',
)

let app: INestApplication
let prisma: PrismaService
let ledger: LedgerService

const slug = `word-${randomUUID().slice(0, 8)}`
const brandName = `Заведение-слово ${slug}`
const deviceId = `owner-${slug}`
let membershipId: string
let newTenantId: string
let ownerId: string
let sessionsBefore: number

const server = (): Server => app.getHttpServer() as Server

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)

  // Как заводил старый provision.ts: слово вместо UUID и у заведения, и у владельца.
  await prisma.tenant.create({
    data: { id: slug, brandName, vertical: 'RESTAURANT', status: 'ACTIVE', settings: {} },
  })
  await prisma.staff.create({
    data: {
      id: `${slug}-owner`,
      tenantId: slug,
      role: 'OWNER',
      displayName: 'Владелец',
      pinHash: await hashPin(PIN),
    },
  })
  await prisma.staffDevice.create({
    data: { tenantId: slug, staffId: `${slug}-owner`, deviceId, label: 'Телефон владельца' },
  })

  // Гость без единой операции — так и на бою: журнал append-only, его строки
  // миграция переписать не может и не должна.
  const guest = await prisma.guest.create({ data: { locale: 'ru' }, select: { id: true } })
  const membership = await prisma.membership.create({
    data: { guestId: guest.id, tenantId: slug },
    select: { id: true },
  })
  membershipId = membership.id

  // Владелец уже входил: на бою у Kefir таких сессий двадцать одна.
  await request(server()).post('/v1/auth/staff/pin').send({ deviceId, pin: PIN })
  sessionsBefore = await prisma.session.count({ where: { tenantId: slug } })
})

afterAll(async () => {
  await app.close()
})

describe('Заведения с id-словом переходят на UUID', () => {
  it('ЗАВЕДЕНИЕ ПЕРЕЕЗЖАЕТ ВМЕСТЕ С ВЛАДЕЛЬЦЕМ, УСТРОЙСТВОМ И ГОСТЯМИ', async () => {
    await prisma.$executeRawUnsafe(MIGRATION)

    expect(await prisma.tenant.findUnique({ where: { id: slug } })).toBeNull()

    const tenant = await prisma.tenant.findFirst({ where: { brandName }, select: { id: true } })
    expect(tenant?.id).toMatch(UUID)
    newTenantId = tenant?.id ?? ''

    const owner = await prisma.staff.findFirst({
      where: { tenantId: newTenantId, role: 'OWNER' },
      select: { id: true },
    })
    expect(owner?.id).toMatch(UUID)
    ownerId = owner?.id ?? ''

    expect(await prisma.staff.findUnique({ where: { id: `${slug}-owner` } })).toBeNull()
    expect(await prisma.staffDevice.findUnique({ where: { deviceId } })).toMatchObject({
      tenantId: newTenantId,
      staffId: ownerId,
    })
    expect(await prisma.membership.findUnique({ where: { id: membershipId } })).toMatchObject({
      tenantId: newTenantId,
    })

    // Старые сессии несут прежние id внутри токена — их не переносят, а забывают.
    expect(sessionsBefore).toBeGreaterThan(0)
    expect(await prisma.session.count({ where: { tenantId: slug } })).toBe(0)
  })

  it('ВЛАДЕЛЕЦ ВХОДИТ ТЕМ ЖЕ КОДОМ УСТРОЙСТВА И PIN — УЖЕ В UUID-ЗАВЕДЕНИЕ', async () => {
    const response = await request(server())
      .post('/v1/auth/staff/pin')
      .send({ deviceId, pin: PIN })
      .expect(200)

    expect(response.body).toMatchObject({
      subject: { tenantId: newTenantId, staffId: ownerId, role: 'OWNER' },
    })
  })

  it('ЖУРНАЛ ПРИНИМАЕТ НАЧИСЛЕНИЕ ПЕРЕЕХАВШЕГО ЗАВЕДЕНИЯ', async () => {
    const result = await ledger.earn(
      {
        membershipId,
        amount: 500,
        idempotencyKey: `uuid-migration:${slug}`,
        source: 'POS_WEBHOOK',
        actorType: 'SYSTEM',
      },
      { tenantId: newTenantId },
    )

    expect(result.entry).toMatchObject({ tenantId: newTenantId, amount: 500 })
  })

  it('ПОВТОРНЫЙ ПРОГОН НИЧЕГО НЕ МЕНЯЕТ', async () => {
    await prisma.$executeRawUnsafe(MIGRATION)

    const tenant = await prisma.tenant.findFirst({ where: { brandName }, select: { id: true } })
    expect(tenant?.id).toBe(newTenantId)
  })
})
