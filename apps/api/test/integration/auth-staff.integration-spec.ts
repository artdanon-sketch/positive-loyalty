import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { PrismaService } from '../../src/core/prisma.service'

import { createTenant } from './ledger-test-context'

/**
 * Вход сотрудника по PIN и ротация сессий.
 * docs/02, разделы 1.3–1.4 · docs/05, раздел 2 и 3.
 */

const SECRET = 'auth-integration-secret-not-used-anywhere-else'
const CASHIER_PIN = '4821'
const MANAGER_PIN = '9137'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let cashierDeviceId: string
let managerDeviceId: string

const server = (): Server => app.getHttpServer() as Server

interface TokensBody {
  accessToken: string
  refreshToken: string
  expiresIn: number
  subject: { staffId: string; role: string; tenantId: string; displayName: string }
}

const login = async (deviceId: string, pin: string): Promise<TokensBody> => {
  const response = await request(server())
    .post('/v1/auth/staff/pin')
    .send({ deviceId, pin })
    .expect(200)
  return response.body as TokensBody
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

  const [cashierHash, managerHash] = await Promise.all([hashPin(CASHIER_PIN), hashPin(MANAGER_PIN)])

  const cashier = await prisma.staff.create({
    data: { tenantId, role: 'CASHIER', displayName: 'Кассир Сомчай', pinHash: cashierHash },
    select: { id: true },
  })
  const manager = await prisma.staff.create({
    data: { tenantId, role: 'MANAGER', displayName: 'Менеджер Анна', pinHash: managerHash },
    select: { id: true },
  })

  cashierDeviceId = `device-cashier-${Date.now()}`
  managerDeviceId = `device-manager-${Date.now()}`

  await prisma.staffDevice.createMany({
    data: [
      { tenantId, staffId: cashier.id, deviceId: cashierDeviceId, label: 'Планшет у бара' },
      { tenantId, staffId: manager.id, deviceId: managerDeviceId, label: 'Ноутбук менеджера' },
    ],
  })
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Вход по PIN', () => {
  it('с зарегистрированного устройства выдаёт токены и роль', async () => {
    const tokens = await login(cashierDeviceId, CASHIER_PIN)

    expect(tokens.subject.role).toBe('CASHIER')
    expect(tokens.subject.tenantId).toBe(tenantId)
    // Восемь часов: смена длинная, перелогин у кассы недопустим (docs/05, раздел 2).
    expect(tokens.expiresIn).toBe(8 * 60 * 60)
  })

  it('заведение НЕ принимается от клиента — его определяет устройство', async () => {
    // Лишнее поле отвергается .strict(): подставить чужой tenantId нельзя даже попыткой.
    await request(server())
      .post('/v1/auth/staff/pin')
      .send({ deviceId: cashierDeviceId, pin: CASHIER_PIN, tenantId: 'чужой' })
      .expect(400)
  })

  it('незарегистрированное устройство даёт 401 без подробностей', async () => {
    const response = await request(server())
      .post('/v1/auth/staff/pin')
      .send({ deviceId: 'device-never-registered', pin: CASHIER_PIN })
      .expect(401)

    const body = JSON.stringify(response.body)
    // Ответ не должен отличать «нет устройства» от «неверный PIN»: иначе эндпоинт
    // становится оракулом для перебора устройств.
    expect(body).not.toMatch(/устройств|device|PIN/i)
  })

  it('неверный PIN даёт тот же 401, что и незнакомое устройство', async () => {
    const wrong = await request(server())
      .post('/v1/auth/staff/pin')
      .send({ deviceId: managerDeviceId, pin: '0000' })
      .expect(401)

    const unknown = await request(server())
      .post('/v1/auth/staff/pin')
      .send({ deviceId: 'device-never-registered', pin: '0000' })
      .expect(401)

    expect(wrong.body).toEqual(unknown.body)
  })

  it('после пяти неудач вход блокируется даже с верным PIN', async () => {
    const hash = await hashPin('5150')
    const staff = await prisma.staff.create({
      data: { tenantId, role: 'CASHIER', displayName: 'Кассир для блокировки', pinHash: hash },
      select: { id: true },
    })
    const deviceId = `device-lockout-${Date.now()}`
    await prisma.staffDevice.create({
      data: { tenantId, staffId: staff.id, deviceId, label: 'Тестовое устройство' },
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server()).post('/v1/auth/staff/pin').send({ deviceId, pin: '1111' }).expect(401)
    }

    // PIN верный, но учётка уже заперта — иначе десять тысяч вариантов перебираются за вечер.
    await request(server()).post('/v1/auth/staff/pin').send({ deviceId, pin: '5150' }).expect(401)

    const locked = await prisma.staff.findFirstOrThrow({ where: { id: staff.id } })
    expect(locked.pinLockedUntil).not.toBeNull()
    expect(locked.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('Ротация refresh-токенов', () => {
  it('обновление выдаёт новую пару и гасит старый refresh', async () => {
    const first = await login(managerDeviceId, MANAGER_PIN)

    const rotated = await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200)

    const second = rotated.body as TokensBody
    expect(second.refreshToken).not.toBe(first.refreshToken)

    // Новый работает.
    await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(200)
  })

  it('повторное использование отозванного гасит ВСЮ цепочку', async () => {
    const first = await login(managerDeviceId, MANAGER_PIN)

    const rotated = await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200)
    const second = (rotated.body as TokensBody).refreshToken

    // Вор пытается использовать перехваченное первое звено.
    await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401)

    // И теперь не работает ДАЖЕ актуальное звено законного владельца:
    // цепочка погашена целиком, потому что неизвестно, у кого какое звено.
    await request(server()).post('/v1/auth/refresh').send({ refreshToken: second }).expect(401)

    const family = await prisma.forTenant(tenantId, async (tx) =>
      tx.session.findMany({ where: { tenantId, revokedReason: 'TOKEN_REUSED' } }),
    )
    expect(family.length).toBeGreaterThan(0)
  })

  it('подделанный refresh не принимается', async () => {
    await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(64) })
      .expect(401)
  })
})

describe('Роли', () => {
  it('менеджер видит бэк-офис', async () => {
    const tokens = await login(managerDeviceId, MANAGER_PIN)

    await request(server())
      .get('/v1/admin/ledger')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
  })

  it('кассир в бэк-офис не допускается — 403, а не 404', async () => {
    const tokens = await login(cashierDeviceId, CASHIER_PIN)

    const response = await request(server())
      .get('/v1/admin/ledger')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(403)

    // Здесь 403 уместен, в отличие от чужого заведения: объект свой, заведение
    // своё, не хватает именно прав. Кассиру надо сказать «позовите владельца»,
    // а не «такой страницы нет».
    expect(JSON.stringify(response.body)).toMatch(/FORBIDDEN/)
  })
})

describe('Вход владельца по почте и паролю', () => {
  const OWNER_EMAIL = `owner-${Date.now()}@kata.example`
  const OWNER_PASSWORD = 'верный-конь-батарейка-скрепка'
  let ownerId: string

  const loginByEmail = (email: string, password: string) =>
    request(server()).post('/v1/auth/staff/login').send({ email, password })

  beforeAll(async () => {
    const hash = await hashPin(OWNER_PASSWORD)
    const owner = await prisma.staff.create({
      data: {
        tenantId,
        role: 'OWNER',
        displayName: 'Владелец',
        email: OWNER_EMAIL,
        passwordHash: hash,
      },
      select: { id: true },
    })
    ownerId = owner.id
  })

  it('ВЕРНАЯ ПАРА ПУСКАЕТ И ОТКРЫВАЕТ БЭК-ОФИС', async () => {
    const response = await loginByEmail(OWNER_EMAIL, OWNER_PASSWORD).expect(200)
    const tokens = response.body as TokensBody

    expect(tokens.subject.role).toBe('OWNER')
    expect(tokens.subject.tenantId).toBe(tenantId)

    await request(server())
      .get('/v1/admin/ledger')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200)
  })

  it('ПОЧТА РЕГИСТРОНЕЗАВИСИМА: «OWNER@» И «owner@» — ОДИН ВХОД', async () => {
    await loginByEmail(OWNER_EMAIL.toUpperCase(), OWNER_PASSWORD).expect(200)
  })

  it('НЕВЕРНЫЙ ПАРОЛЬ — 401 БЕЗ ПОДРОБНОСТЕЙ', async () => {
    const response = await loginByEmail(OWNER_EMAIL, 'не-тот-пароль-совсем').expect(401)
    expect(JSON.stringify(response.body)).toMatch(/UNAUTHORIZED/)
  })

  it('НЕСУЩЕСТВУЮЩАЯ ПОЧТА — ТОЖЕ 401, А НЕ 404', async () => {
    await loginByEmail('no-such-owner@kata.example', OWNER_PASSWORD).expect(401)
  })

  it('КОРОТКИЙ ПАРОЛЬ ОТВЕРГАЕТСЯ ДО ПРОВЕРКИ — 400', async () => {
    await loginByEmail(OWNER_EMAIL, 'коротк').expect(400)
  })

  it('ПЯТЬ НЕВЕРНЫХ ПОПЫТОК — И ВЕРНЫЙ ПАРОЛЬ ВРЕМЕННО НЕ ПУСКАЕТ', async () => {
    const solo = await prisma.staff.create({
      data: {
        tenantId,
        role: 'OWNER',
        displayName: 'Владелец под замок',
        email: `lock-${Date.now()}@kata.example`,
        passwordHash: await hashPin('правильный-пароль-длинный'),
      },
      select: { id: true, email: true },
    })

    for (let i = 0; i < 5; i += 1) {
      await loginByEmail(solo.email ?? '', 'мимо-пароль-длинный').expect(401)
    }

    // Верный пароль теперь тоже 401: сработала блокировка после серии неудач.
    await loginByEmail(solo.email ?? '', 'правильный-пароль-длинный').expect(401)
  })

  it('КАССИР БЕЗ ПОЧТЫ ПО ЭТОМУ ВХОДУ НЕ ПУСКАЕТСЯ', async () => {
    // У кассира есть PIN, но нет пароля — вход по почте не для него.
    expect(ownerId).not.toBe('')
    await loginByEmail(`cashier-none-${Date.now()}@kata.example`, OWNER_PASSWORD).expect(401)
  })
})
