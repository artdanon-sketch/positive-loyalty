import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AutomationRunService } from '../../src/admin/automation-run.service'
import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'

import {
  createMembershipFixture,
  createTenant,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Автоматические сценарии. docs/02, раздел 5.4.1 · docs/03, раздел 5.
 *
 * Полигон: заведение со спящим гостем (последний визит два месяца назад) и
 * соседнее заведение со своим спящим гостем и выключенным сценарием.
 *
 * Проверяется главное свойство: сценарий создаёт ОБЫЧНУЮ рассылку и делает это
 * не чаще раза в сутки. Ошибка здесь стоит не денег, а доверия: гость получит
 * одно и то же письмо столько раз, сколько пройдёт разгребатель.
 */

const SECRET = 'automation-secret-not-used-anywhere-else'
const DAY_MS = 24 * 60 * 60 * 1000

let app: INestApplication
let prisma: PrismaService
let runner: AutomationRunService
let tenantId: string
let neighbourTenantId: string
let ownerToken: string
let neighbourToken: string
let sleeper: MembershipFixture

const server = (): Server => app.getHttpServer() as Server

interface RuleBody {
  kind: string
  enabled: boolean
  threshold: number
  text: string
  lastRunAt: string | null
}

const rules = async (token: string): Promise<RuleBody[]> => {
  const response = await request(server())
    .get('/v1/admin/automation')
    .set('Authorization', `Bearer ${token}`)

  return (response.body as { items: RuleBody[] }).items
}

const broadcastsOf = async (tenant: string) =>
  prisma.broadcast.findMany({
    where: { tenantId: tenant },
    select: { id: true, title: true, audience: true },
  })

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  runner = moduleRef.get(AutomationRunService)

  tenantId = await createTenant(prisma)
  neighbourTenantId = await createTenant(prisma)

  sleeper = await createMembershipFixture(prisma, { tenantId })
  const neighbourSleeper = await createMembershipFixture(prisma, { tenantId: neighbourTenantId })

  // Оба гостя были и пропали два месяца назад — условие сценария выполнено.
  const longAgo = new Date(Date.now() - 60 * DAY_MS)
  await prisma.membership.updateMany({
    where: { id: { in: [sleeper.membershipId, neighbourSleeper.membershipId] } },
    data: { lastVisitAt: longAgo },
  })

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  neighbourToken = signAccessToken(
    { tenantId: neighbourTenantId, actorId: null, role: 'OWNER' },
    SECRET,
  )
})

afterAll(async () => {
  await app.close()
})

describe('Автосценарии: настройка', () => {
  it('ТРИ СЦЕНАРИЯ ВИДНЫ СРАЗУ, ЕЩЁ НИ РАЗУ НЕ ВКЛЮЧЁННЫЕ', async () => {
    const items = await rules(ownerToken)

    expect(items.map((item) => item.kind)).toEqual([
      'SLEEPING',
      'JOINED_NO_PURCHASE',
      'SPENT_TOTAL',
    ])
    expect(items.every((item) => !item.enabled && item.lastRunAt === null)).toBe(true)
  })

  it('ПОРОГ ПРОВЕРЯЕТСЯ ПО ВИДУ СЦЕНАРИЯ: ДЛЯ «СПЯЩИХ» ЭТО ДНИ, А НЕ БАТЫ', async () => {
    const response = await request(server())
      .put('/v1/admin/automation/SLEEPING')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ enabled: true, threshold: 1_000_000, text: 'Соскучились!' })

    expect(response.status).toBe(400)
  })

  it('ВЛАДЕЛЕЦ ВКЛЮЧАЕТ СЦЕНАРИЙ И МЕНЯЕТ ТЕКСТ', async () => {
    const response = await request(server())
      .put('/v1/admin/automation/SLEEPING')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ enabled: true, threshold: 30, text: 'Соскучились! Заходите на кофе.' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ kind: 'SLEEPING', enabled: true, threshold: 30 })

    const items = await rules(ownerToken)
    expect(items.find((item) => item.kind === 'SLEEPING')).toMatchObject({
      enabled: true,
      text: 'Соскучились! Заходите на кофе.',
    })
  })

  it('НАСТРОЙКА СОСЕДА НЕ ВИДНА И НЕ ТРОНУТА', async () => {
    const items = await rules(neighbourToken)

    expect(items.find((item) => item.kind === 'SLEEPING')?.enabled).toBe(false)
  })
})

describe('Автосценарии: запуск', () => {
  it('ВКЛЮЧЁННЫЙ СЦЕНАРИЙ СОЗДАЁТ ОБЫЧНУЮ РАССЫЛКУ СО СВОЕЙ АУДИТОРИЕЙ', async () => {
    await runner.tick()

    const created = await broadcastsOf(tenantId)

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      title: 'Автосценарий: давно не заходили',
      audience: { sleeping: 30 },
    })
    // Снимок аудитории сделан при создании, а не при отправке: спящий гость
    // уже записан в получатели, и поздние изменения базы его не выкинут.
    const recipients = await prisma.broadcastRecipient.count({
      where: { broadcastId: created[0]?.id, guestId: sleeper.guestId },
    })
    expect(recipients).toBe(1)
  })

  it('ВТОРОЙ ПРОХОД В ТОТ ЖЕ ДЕНЬ НИЧЕГО НЕ ДОБАВЛЯЕТ', async () => {
    const result = await runner.tick()

    expect(result.started).toBe(0)
    expect(await broadcastsOf(tenantId)).toHaveLength(1)
  })

  /**
   * Проход за проходом, пока сценарий ЭТОГО заведения не отработает в момент
   * now. Разгребатель берёт за раз несколько заведений, и в общей тестовой базе
   * чужие сценарии могут занять очередь; счётчик «запущено» считает их тоже,
   * поэтому смотрим на отметку своего правила и на свои рассылки.
   */
  const runAt = async (now: Date): Promise<void> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runner.tick(now)
      const rule = await prisma.automationRule.findFirst({
        where: { tenantId, kind: 'SLEEPING' },
        select: { lastRunAt: true },
      })

      if (rule?.lastRunAt?.getTime() === now.getTime()) {
        return
      }
    }

    throw new Error('сценарий заведения так и не отработал')
  }

  it('ЗАВТРА ТОМУ ЖЕ СПЯЩЕМУ ВТОРОЙ РАЗ НЕ ПИШЕМ — ТОЛЬКО НОВОМУ СПЯЩЕМУ', async () => {
    // Спящий остаётся спящим и завтра. Раньше сценарий писал ему каждый день,
    // пока не упрётся в усталость, — а с подарком дарил бы каждый день.
    await runAt(new Date(Date.now() + DAY_MS + 60_000))
    expect(await broadcastsOf(tenantId)).toHaveLength(1)

    const newcomer = await createMembershipFixture(prisma, { tenantId })
    await prisma.membership.update({
      where: { id: newcomer.membershipId },
      data: { lastVisitAt: new Date(Date.now() - 45 * DAY_MS) },
    })

    await runAt(new Date(Date.now() + 2 * DAY_MS + 120_000))

    const created = await broadcastsOf(tenantId)
    expect(created).toHaveLength(2)

    const recipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: { in: created.map((row) => row.id) } },
      select: { guestId: true },
    })
    // Прежний спящий — в первой рассылке и только в ней.
    expect(recipients.filter((row) => row.guestId === sleeper.guestId)).toHaveLength(1)
    expect(recipients.filter((row) => row.guestId === newcomer.guestId)).toHaveLength(1)
  })

  it('ГОСТЬ ПРИШЁЛ И СНОВА УСНУЛ — НОВЫЙ ЭПИЗОД, ЕМУ ПИШЕМ СНОВА', async () => {
    // Визит месяц с лишним назад — позже прежнего: это новая история гостя.
    await prisma.membership.update({
      where: { id: sleeper.membershipId },
      data: { lastVisitAt: new Date(Date.now() - 35 * DAY_MS) },
    })

    await runAt(new Date(Date.now() + 3 * DAY_MS + 180_000))

    const created = await broadcastsOf(tenantId)
    expect(created).toHaveLength(3)
    expect(
      await prisma.broadcastRecipient.count({
        where: { broadcastId: { in: created.map((row) => row.id) }, guestId: sleeper.guestId },
      }),
    ).toBe(2)
  })

  it('ВЫКЛЮЧЕННЫЙ СЦЕНАРИЙ СОСЕДА МОЛЧИТ, ХОТЯ ГОСТЬ У НЕГО ТОЖЕ СПЯЩИЙ', async () => {
    expect(await broadcastsOf(neighbourTenantId)).toHaveLength(0)
  })
})
