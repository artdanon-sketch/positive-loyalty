import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { hashPin } from '../../src/auth/pin'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import { createTenant } from './ledger-test-context'

/**
 * Команда заведения: добавить, отключить, повысить, сменить PIN.
 * docs/02, раздел 5.5 · docs/05, раздел 3.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 * Не «кнопка добавляет строку» — это проверил бы и юнит-тест. Здесь проверяется
 * то, что делает экран честным:
 *
 *   отключение     режет доступ СРАЗУ, а не когда истечёт восьмичасовой токен.
 *                  Иначе уволенный кассир начисляет до конца смены — ровно то,
 *                  ради чего его увольняли;
 *   повышение      действует без повторного входа: роль берётся из базы
 *                  на каждом запросе, а не из токена;
 *   новый PIN      отзывает старые сессии и снимает блокировку;
 *   владелец       не редактируется из списка — один неверный тап не должен
 *                  запирать заведение;
 *   чужая команда  не видна и не изменяема — ответ как на несуществующего.
 *
 * Токены владельца и менеджера подписаны с НАСТОЯЩИМИ идентификаторами
 * сотрудников: middleware сверяет сотрудника с базой, и токен без живой строки
 * в таблице теперь не проходит.
 */

const SECRET = 'admin-staff-secret-not-used-anywhere-else'
const HOUR = 60 * 60

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let ownerId: string
let ownerToken: string
let managerToken: string
let foreignOwnerToken: string

const server = (): Server => app.getHttpServer() as Server

interface StaffBody {
  id: string
  displayName: string
  role: string
  isActive: boolean
  isLocked: boolean
  devices: Array<{ deviceCode: string; label: string; isActive: boolean }>
}

interface TokensBody {
  accessToken: string
  refreshToken: string
  subject: { role: string }
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Владелец добавляет кассира и получает код устройства. */
const addCashier = async (
  pin: string,
  name = `Кассир ${Math.random().toString(36).slice(2, 6)}`,
): Promise<{ id: string; deviceCode: string }> => {
  const response = await request(server())
    .post('/v1/admin/staff')
    .set(as(ownerToken))
    .send({ displayName: name, role: 'CASHIER', pin, deviceLabel: 'Касса у бара' })
    .expect(201)

  const body = response.body as { staff: StaffBody; deviceCode: string }
  return { id: body.staff.id, deviceCode: body.deviceCode }
}

const login = (deviceId: string, pin: string) =>
  request(server()).post('/v1/auth/staff/pin').send({ deviceId, pin })

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
  const foreignTenantId = await createTenant(prisma)

  const pinHash = await hashPin('7305')

  const owner = await prisma.staff.create({
    data: { tenantId, role: 'OWNER', displayName: 'Владелец', pinHash },
    select: { id: true },
  })
  const manager = await prisma.staff.create({
    data: { tenantId, role: 'MANAGER', displayName: 'Менеджер', pinHash },
    select: { id: true },
  })
  const foreignOwner = await prisma.staff.create({
    data: { tenantId: foreignTenantId, role: 'OWNER', displayName: 'Чужой владелец', pinHash },
    select: { id: true },
  })

  ownerId = owner.id
  ownerToken = signAccessToken({ tenantId, actorId: owner.id, role: 'OWNER' }, SECRET, HOUR)
  managerToken = signAccessToken({ tenantId, actorId: manager.id, role: 'MANAGER' }, SECRET, HOUR)
  foreignOwnerToken = signAccessToken(
    { tenantId: foreignTenantId, actorId: foreignOwner.id, role: 'OWNER' },
    SECRET,
    HOUR,
  )
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('Добавление сотрудника', () => {
  it('ВЛАДЕЛЕЦ ДОБАВЛЯЕТ КАССИРА, И ТОТ ВХОДИТ С КОДОМ УСТРОЙСТВА И PIN', async () => {
    // Весь смысл экрана в одном тесте: без этого пути сотрудник существовал
    // только в демо-скрипте, и заведение не могло сменить персонал.
    const { deviceCode } = await addCashier('4829')

    expect(deviceCode).toMatch(/^pos-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/)

    const response = await login(deviceCode, '4829').expect(200)
    expect((response.body as TokensBody).subject.role).toBe('CASHIER')
  })

  it('PIN НЕ ВОЗВРАЩАЕТСЯ НИ В КАКОМ ВИДЕ', async () => {
    const response = await request(server())
      .post('/v1/admin/staff')
      .set(as(ownerToken))
      .send({ displayName: 'Сомчай', role: 'CASHIER', pin: '9046' })
      .expect(201)

    const text = JSON.stringify(response.body)
    expect(text).not.toContain('9046')
    expect(text).not.toContain('pinHash')
    expect(text).not.toContain('scrypt')

    const list = await request(server()).get('/v1/admin/staff').set(as(ownerToken)).expect(200)
    expect(JSON.stringify(list.body)).not.toContain('scrypt')
  })

  it('слишком простой PIN отвергается со словами, понятными владельцу', async () => {
    const response = await request(server())
      .post('/v1/admin/staff')
      .set(as(ownerToken))
      .send({ displayName: 'Сомчай', role: 'CASHIER', pin: '1234' })
      .expect(400)

    expect((response.body as { error: { message: string } }).error.message).toContain('простой')
  })

  it('ДОБАВЛЕНИЕ ПОПАДАЕТ В АУДИТ — БЕЗ PIN', async () => {
    const { id } = await addCashier('6173')

    const rows = await prisma.$queryRaw<Array<{ newValue: unknown }>>`
      SELECT "newValue" FROM "AuditLog" WHERE "entityId" = ${id} AND "action" = 'STAFF_CREATED'
    `

    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0]?.newValue)).not.toContain('6173')
  })
})

describe('Права', () => {
  it('МЕНЕДЖЕР КОМАНДОЙ НЕ УПРАВЛЯЕТ', async () => {
    // Менеджер, способный выдать себе или приятелю доступ к кассе, обходил бы
    // весь антифрод кассиров одним действием. Матрица docs/05: только владелец.
    await request(server()).get('/v1/admin/staff').set(as(managerToken)).expect(403)
    await request(server())
      .post('/v1/admin/staff')
      .set(as(managerToken))
      .send({ displayName: 'Друг', role: 'MANAGER', pin: '5820' })
      .expect(403)
  })

  it('ВЛАДЕЛЬЦА ИЗ СПИСКА НЕ ИЗМЕНИТЬ И НЕ ОТКЛЮЧИТЬ', async () => {
    // Иначе один неверный тап по своей строке запирал бы заведение от того,
    // кто единственный может его отпереть.
    const response = await request(server())
      .patch(`/v1/admin/staff/${ownerId}`)
      .set(as(ownerToken))
      .send({ isActive: false })
      .expect(403)

    expect((response.body as { error: { code: string } }).error.code).toBe('OWNER_NOT_MANAGED')

    const owner = await prisma.staff.findUnique({ where: { id: ownerId } })
    expect(owner?.isActive).toBe(true)
  })

  it('ЧУЖАЯ КОМАНДА НЕ ВИДНА И НЕ ИЗМЕНЯЕМА — ОТВЕТ КАК НА НЕСУЩЕСТВУЮЩЕГО', async () => {
    const { id } = await addCashier('3958')

    const foreignList = await request(server())
      .get('/v1/admin/staff')
      .set(as(foreignOwnerToken))
      .expect(200)
    expect((foreignList.body as StaffBody[]).some((member) => member.id === id)).toBe(false)

    await request(server())
      .patch(`/v1/admin/staff/${id}`)
      .set(as(foreignOwnerToken))
      .send({ isActive: false })
      .expect(404)

    await request(server())
      .post(`/v1/admin/staff/${id}/pin`)
      .set(as(foreignOwnerToken))
      .send({ pin: '5820' })
      .expect(404)

    const untouched = await prisma.staff.findUnique({ where: { id } })
    expect(untouched?.isActive).toBe(true)
  })
})

describe('Отключение и роли', () => {
  it('ОТКЛЮЧЕНИЕ ОТРЕЗАЕТ ДОСТУП СРАЗУ, А НЕ ЧЕРЕЗ ВОСЕМЬ ЧАСОВ', async () => {
    const { id, deviceCode } = await addCashier('2764')
    const tokens = (await login(deviceCode, '2764').expect(200)).body as TokensBody

    await request(server()).get('/v1/pos/config').set(as(tokens.accessToken)).expect(200)

    await request(server())
      .patch(`/v1/admin/staff/${id}`)
      .set(as(ownerToken))
      .send({ isActive: false })
      .expect(200)

    // Тот же токен, выданный минуту назад и живой ещё восемь часов, — отказ.
    // Без проверки сотрудника по базе этот запрос прошёл бы.
    await request(server()).get('/v1/pos/config').set(as(tokens.accessToken)).expect(401)

    // Обновить сессию тоже нельзя: она отозвана.
    await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401)

    // И войти заново — тоже.
    await login(deviceCode, '2764').expect(401)
  })

  it('включённый обратно сотрудник снова входит', async () => {
    const { id, deviceCode } = await addCashier('8315')

    await request(server())
      .patch(`/v1/admin/staff/${id}`)
      .set(as(ownerToken))
      .send({ isActive: false })
      .expect(200)
    await request(server())
      .patch(`/v1/admin/staff/${id}`)
      .set(as(ownerToken))
      .send({ isActive: true })
      .expect(200)

    await login(deviceCode, '8315').expect(200)
  })

  it('ПОВЫШЕНИЕ ДО МЕНЕДЖЕРА ДЕЙСТВУЕТ БЕЗ ПОВТОРНОГО ВХОДА', async () => {
    const { id, deviceCode } = await addCashier('4096')
    const tokens = (await login(deviceCode, '4096').expect(200)).body as TokensBody

    // Роль в токене — CASHIER, бэк-офис закрыт.
    await request(server()).get('/v1/admin/guests').set(as(tokens.accessToken)).expect(403)

    await request(server())
      .patch(`/v1/admin/staff/${id}`)
      .set(as(ownerToken))
      .send({ role: 'MANAGER' })
      .expect(200)

    // Тот же токен: роль берётся из базы, а не из подписи, и повышение
    // действует сразу. Человека не выкидывает из системы посреди смены.
    await request(server()).get('/v1/admin/guests').set(as(tokens.accessToken)).expect(200)
  })

  it('ПОНИЖЕНИЕ ТОЖЕ ДЕЙСТВУЕТ СРАЗУ', async () => {
    // Обратная сторона того же: понижённый менеджер не должен сохранять право
    // отменять чужие операции до конца срока токена.
    const response = await request(server())
      .post('/v1/admin/staff')
      .set(as(ownerToken))
      .send({ displayName: 'Менеджер смены', role: 'MANAGER', pin: '6427' })
      .expect(201)
    const body = response.body as { staff: StaffBody; deviceCode: string }

    const tokens = (await login(body.deviceCode, '6427').expect(200)).body as TokensBody
    await request(server()).get('/v1/admin/guests').set(as(tokens.accessToken)).expect(200)

    await request(server())
      .patch(`/v1/admin/staff/${body.staff.id}`)
      .set(as(ownerToken))
      .send({ role: 'CASHIER' })
      .expect(200)

    await request(server()).get('/v1/admin/guests').set(as(tokens.accessToken)).expect(403)
  })
})

describe('Новый PIN', () => {
  it('СТАРЫЙ PIN НЕ ПОДХОДИТ, СЕССИИ ОТОЗВАНЫ, БЛОКИРОВКА СНЯТА', async () => {
    const { id, deviceCode } = await addCashier('5183')
    const tokens = (await login(deviceCode, '5183').expect(200)).body as TokensBody

    // Кассир перебрал варианты и заблокирован.
    await prisma.staff.update({
      where: { id },
      data: { pinFailedAttempts: 5, pinLockedUntil: new Date(Date.now() + HOUR * 1000) },
    })

    const reset = await request(server())
      .post(`/v1/admin/staff/${id}/pin`)
      .set(as(ownerToken))
      .send({ pin: '7942' })
      .expect(200)
    expect((reset.body as StaffBody).isLocked).toBe(false)

    await login(deviceCode, '5183').expect(401)
    await login(deviceCode, '7942').expect(200)

    // PIN меняют и потому, что его узнал чужой. Живая старая сессия — ровно
    // тот доступ, который хотели отрезать.
    await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401)
  })
})
