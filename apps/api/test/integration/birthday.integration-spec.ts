import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { localDay } from '../../src/common/time/local-day'
import { PrismaService } from '../../src/core/prisma.service'
import type { Prisma } from '../../src/generated/prisma/client'

import { createMembershipFixture, createTenant, readBalance } from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Подарок ко дню рождения. docs/02, разделы 2.7 и 5.6.3 · docs/11, У9.
 *
 * Приёмка из docs/11: гость с днём рождения завтра открывает кошелёк и видит подарок;
 * повторное открытие второго не даёт.
 *
 * Полигон: гость в двух заведениях. Первое дарит 100 ฿ баллами, второе — сертификат
 * из шаблона. Гость из контрольной группы в первом заведении подарка не получает.
 */

const SECRET = 'birthday-secret-not-used-anywhere-else'
const POINTS = 10_000

let app: INestApplication
let prisma: PrismaService
let pointsVenue: MembershipFixture
let certificateVenue: MembershipFixture
let control: MembershipFixture
let certificateId: string
let ownerToken: string

const server = (): Server => app.getHttpServer() as Server

const guestRequest = (guestId: string) => ({
  get: (path: string) =>
    request(server())
      .get(path)
      .set('Authorization', `Bearer ${signGuestToken({ guestId }, SECRET)}`),
  put: (path: string, body: Record<string, unknown>) =>
    request(server())
      .put(path)
      .set('Authorization', `Bearer ${signGuestToken({ guestId }, SECRET)}`)
      .send(body),
})

/** Завтрашняя дата по часам заведения, но 1990 года: день рождения — завтра. */
const tomorrowBirthday = (): string => {
  const tomorrow = new Date(localDay('Asia/Bangkok', new Date()).getTime() + 24 * 60 * 60 * 1000)
  const month = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
  const day = String(tomorrow.getUTCDate()).padStart(2, '0')
  // 29 февраля бывает не в каждом году — на этот день берём високосный 1988-й.
  return `${month === '02' && day === '29' ? '1988' : '1990'}-${month}-${day}`
}

const writeSettings = async (tenantId: string, settings: Prisma.InputJsonObject): Promise<void> => {
  await prisma.forTenant(tenantId, async (tx) =>
    tx.tenant.update({ where: { id: tenantId }, data: { settings } }),
  )
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

  pointsVenue = await createMembershipFixture(prisma)
  await writeSettings(pointsVenue.tenantId, {
    birthday: {
      enabled: true,
      reward: { kind: 'POINTS', amount: POINTS },
      daysBefore: 3,
      daysAfter: 3,
    },
  })

  const certificateTenant = await createTenant(prisma)
  certificateVenue = await prisma.membership
    .create({
      data: { guestId: pointsVenue.guestId, tenantId: certificateTenant },
      select: { id: true },
    })
    .then((membership) => ({
      ...pointsVenue,
      tenantId: certificateTenant,
      membershipId: membership.id,
      scope: { tenantId: certificateTenant },
    }))

  ownerToken = signAccessToken(
    { tenantId: certificateTenant, actorId: null, role: 'OWNER' },
    SECRET,
  )

  const template = await request(server())
    .post('/v1/admin/certificates')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      title: 'Десерт ко дню рождения',
      value: { kind: 'FREE_ITEM', itemName: 'Десерт' },
      validityDays: 14,
    })
  certificateId = (template.body as { id: string }).id

  control = await createMembershipFixture(prisma, { tenantId: pointsVenue.tenantId })
  await prisma.forTenant(pointsVenue.tenantId, async (tx) =>
    tx.membership.update({ where: { id: control.membershipId }, data: { isControlGroup: true } }),
  )
})

afterAll(async () => {
  await app.close()
})

describe('День рождения гостя', () => {
  it('ГОСТЬ УКАЗЫВАЕТ ДЕНЬ РОЖДЕНИЯ ОДИН РАЗ — ВТОРОЙ РАЗ ИЗМЕНИТЬ НЕЛЬЗЯ', async () => {
    const guest = guestRequest(pointsVenue.guestId)
    const date = tomorrowBirthday()

    const first = await guest.put('/v1/guest/me/birthday', { date })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ birthday: date })

    const second = await guest.put('/v1/guest/me/birthday', { date: '1991-01-01' })
    expect(second.status).toBe(409)
    expect((second.body as { error: { code: string } }).error.code).toBe('BIRTHDAY_ALREADY_SET')

    expect((await guest.get('/v1/guest/me')).body).toMatchObject({ birthday: date })
    expect((await guest.put('/v1/guest/me/birthday', { date: '2999-01-01' })).status).toBe(400)
  })
})

describe('Настройки дня рождения', () => {
  it('ВЛАДЕЛЕЦ ВЫБИРАЕТ СЕРТИФИКАТ ИЗ ШАБЛОНА; ЧУЖОЙ ИЛИ ВЫДУМАННЫЙ ШАБЛОН — 400', async () => {
    const put = (body: Record<string, unknown>) =>
      request(server())
        .put('/v1/admin/settings/program/birthday')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body)

    const saved = await put({
      enabled: true,
      reward: { kind: 'CERTIFICATE', certificateId },
      daysBefore: 3,
      daysAfter: 3,
    })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({
      enabled: true,
      reward: { kind: 'CERTIFICATE', certificateId },
      daysBefore: 3,
      daysAfter: 3,
    })

    const unknown = await put({
      enabled: true,
      reward: { kind: 'CERTIFICATE', certificateId: '99999999-9999-4999-8999-999999999999' },
      daysBefore: 3,
      daysAfter: 3,
    })
    expect(unknown.status).toBe(400)
    expect((unknown.body as { error: { code: string } }).error.code).toBe('CERTIFICATE_NOT_FOUND')
  })
})

describe('Подарок ко дню рождения', () => {
  it('ДЕНЬ РОЖДЕНИЯ ЗАВТРА: КОШЕЛЁК ПРИНОСИТ БАЛЛЫ И СЕРТИФИКАТ — ПОВТОРНОЕ ОТКРЫТИЕ ВТОРОГО НЕ ДАЁТ', async () => {
    const guest = guestRequest(pointsVenue.guestId)

    const first = await guest.get('/v1/guest/wallet')
    expect(first.status).toBe(200)
    await guest.get('/v1/guest/wallet')

    expect(await readBalance(prisma, pointsVenue.membershipId)).toBe(POINTS)

    const vouchers = (
      (await guest.get('/v1/guest/wallet')).body as {
        vouchers: Array<{ tenantId: string; title: string | null }>
      }
    ).vouchers.filter((voucher) => voucher.tenantId === certificateVenue.tenantId)
    expect(vouchers).toEqual([
      expect.objectContaining({ title: 'Десерт ко дню рождения' }) as unknown,
    ])

    const keys = await prisma.forTenant(pointsVenue.tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: { membershipId: pointsVenue.membershipId, type: 'GRANT' },
        select: { idempotencyKey: true },
      }),
    )
    expect(keys.map((row) => row.idempotencyKey)).toEqual([
      expect.stringMatching(new RegExp(`^birthday:${pointsVenue.membershipId}:\\d{4}$`)) as unknown,
    ])
  })

  it('гостю из контрольной группы подарка нет', async () => {
    const guest = guestRequest(control.guestId)
    await guest.put('/v1/guest/me/birthday', { date: tomorrowBirthday() })
    await guest.get('/v1/guest/wallet')

    expect(await readBalance(prisma, control.membershipId)).toBe(0)
  })
})
