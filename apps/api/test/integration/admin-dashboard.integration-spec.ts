import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'

import { createMembershipFixture, idempotencyKey, POS_ORIGIN } from './ledger-test-context'

/**
 * Дашборд заведения. docs/02, раздел 5.1 · docs/03, раздел 2.
 *
 * Главное, что здесь проверяется, — что цифры на главном экране считаются
 * ПО СВОЕМУ заведению. Дашборд агрегирует, а у агрегата нет идентификатора,
 * по которому утечку заметит глаз: чужой чек не появится отдельной строкой,
 * он просто прибавится к сумме. Поэтому рядом с каждым тестом на число стоит
 * тест на изоляцию, а второе заведение намеренно сделано «богаче» первого.
 */

const SECRET = 'admin-dashboard-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let tenantId: string
let managerToken: string
let cashierToken: string
let emptyTenantToken: string
let farZoneToken: string
let farZoneMembershipId: string

/**
 * Пояс для проверки перевода времени. Катманду выбран намеренно: +05:45,
 * то есть смещение НЕ кратно часу. Ошибка в переводе на таком поясе видна
 * сразу, а на любом целочасовом может совпасть со сдвигом сессии соединения.
 */
const FAR_ZONE = 'Asia/Kathmandu'

const server = (): Server => app.getHttpServer() as Server

interface DashboardBody {
  period: string
  guestsViaProgram: { value: number; prev: number; changePct: number | null; newGuests: number }
  pointsLiability: { value: number; prev: number }
  series: Array<{ date: string; new: number; returning: number }>
  hourly: Array<{ hour: number; guests: number }>
  incremental?: { controlSize: number }
  advice: Array<{ kind: string }>
  isPartialPeriod: boolean
  isEmpty: boolean
}

/** Сумма чека и начисление у каждого гостя своя — иначе ошибку в сумме не видно. */
const OWN_RECEIPTS = [100_000, 200_000, 300_000]

/** Чужое заведение заметно богаче: протечка сразу испортит любую цифру. */
const FOREIGN_RECEIPTS = [900_000, 900_000, 900_000, 900_000]

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  const ledger = moduleRef.get(LedgerService)

  const own = await createMembershipFixture(prisma)
  tenantId = own.tenantId

  // Три гостя своего заведения с разными чеками.
  for (const [index, basisAmount] of OWN_RECEIPTS.entries()) {
    const member = index === 0 ? own : await createMembershipFixture(prisma, { tenantId })

    await ledger.earn(
      {
        membershipId: member.membershipId,
        amount: Math.floor(basisAmount * 0.05),
        basisAmount,
        idempotencyKey: idempotencyKey(`dashboard-own-${index}`),
        refType: 'receipt',
        refId: `dash-own-${index}`,
        ...POS_ORIGIN,
      },
      own.scope,
    )
  }

  // Чужое заведение: те же операции, но своих денег гораздо больше.
  const foreign = await createMembershipFixture(prisma)

  for (const [index, basisAmount] of FOREIGN_RECEIPTS.entries()) {
    const member =
      index === 0 ? foreign : await createMembershipFixture(prisma, { tenantId: foreign.tenantId })

    await ledger.earn(
      {
        membershipId: member.membershipId,
        amount: Math.floor(basisAmount * 0.05),
        basisAmount,
        idempotencyKey: idempotencyKey(`dashboard-foreign-${index}`),
        refType: 'receipt',
        refId: `dash-foreign-${index}`,
        ...POS_ORIGIN,
      },
      foreign.scope,
    )
  }

  // Третье заведение вообще без операций — состояние «первый день».
  const empty = await createMembershipFixture(prisma)

  // Четвёртое — со своим часовым поясом: на нём проверяется перевод времени.
  const farZone = await createMembershipFixture(prisma)
  farZoneMembershipId = farZone.membershipId
  await prisma.tenant.update({ where: { id: farZone.tenantId }, data: { timezone: FAR_ZONE } })

  await ledger.earn(
    {
      membershipId: farZone.membershipId,
      amount: 1_000,
      basisAmount: 20_000,
      idempotencyKey: idempotencyKey('dashboard-zone'),
      refType: 'receipt',
      refId: 'dash-zone',
      ...POS_ORIGIN,
    },
    farZone.scope,
  )

  const sign = (tenant: string, role: string): string =>
    signAccessToken({ tenantId: tenant, actorId: null, role }, SECRET)

  managerToken = sign(tenantId, 'MANAGER')
  farZoneToken = sign(farZone.tenantId, 'MANAGER')
  cashierToken = sign(tenantId, 'CASHIER')
  emptyTenantToken = sign(empty.tenantId, 'MANAGER')
}, 120_000)

afterAll(async () => {
  await app.close()
})

const load = async (token: string, query = ''): Promise<DashboardBody> => {
  const response = await request(server())
    .get(`/v1/admin/dashboard${query}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)

  return response.body as DashboardBody
}

describe('Дашборд', () => {
  it('считает гостей и обязательство только по своему заведению', async () => {
    const body = await load(managerToken)

    expect(body.guestsViaProgram.value).toBe(OWN_RECEIPTS.length)
    // Обязательство — ровно 5% с каждого своего чека и ни сатанга чужого.
    const expected = OWN_RECEIPTS.reduce((sum, amount) => sum + Math.floor(amount * 0.05), 0)
    expect(body.pointsLiability.value).toBe(expected)
    // Чужое заведение богаче: протечка подняла бы обязательство минимум втрое.
    expect(body.pointsLiability.value).toBeLessThan(Math.floor(900_000 * 0.05))
  })

  it('все гости первого дня — новые, и это видно на графике', async () => {
    const body = await load(managerToken)

    expect(body.guestsViaProgram.newGuests).toBe(OWN_RECEIPTS.length)
    // Ряд покрывает период целиком, включая дни без визитов: без нулевых
    // столбцов провал на графике не виден.
    expect(body.series).toHaveLength(7)
    const today = body.series.at(-1)
    expect(today?.new).toBe(OWN_RECEIPTS.length)
  })

  it('дельта не выдумывается, когда сравнивать не с чем', async () => {
    const body = await load(managerToken)

    // В прошлом периоде операций не было. Показать «+100%» здесь значило бы
    // разделить на ноль и приукрасить результат.
    expect(body.guestsViaProgram.prev).toBe(0)
    expect(body.guestsViaProgram.changePct).toBeNull()
  })

  it('обязательство на начало периода считается из журнала', async () => {
    const body = await load(managerToken)

    // Все начисления сделаны внутри периода, значит на его начало было ноль.
    expect(body.pointsLiability.prev).toBe(0)
  })

  it('загрузка по часам покрывает сутки целиком', async () => {
    const body = await load(managerToken)

    expect(body.hourly).toHaveLength(24)
    expect(body.hourly.map((point) => point.hour)).toEqual([...Array(24).keys()])
  })

  it('инкрементальность не показывается на маленькой контрольной группе', async () => {
    const body = await load(managerToken)

    // ТЗ (docs/02, раздел 5.1): меньше тридцати человек — статистики нет,
    // и врать нельзя. Поле обязано отсутствовать, а не приезжать нулями.
    expect(body.incremental).toBeUndefined()
  })

  it('заведение без единого гостя показывает пустое состояние', async () => {
    const body = await load(emptyTenantToken)

    expect(body.isEmpty).toBe(true)
    // Пустота меряется тем, оформляли ли гостя ВООБЩЕ, а не тишиной
    // за период: у заведения с историей онбординг-чеклист неуместен.
    expect(body.guestsViaProgram.newGuests).toBe(0)
    expect(body.guestsViaProgram.value).toBe(0)
    expect(body.pointsLiability.value).toBe(0)
    // Советы на пустом заведении не выдумываются: советовать нечего.
    expect(body.advice).toEqual([])
  })

  it('заведение с историей, но без визитов за период, не считается пустым', async () => {
    // У своего заведения гости есть. Если бы `isEmpty` считалась по тишине
    // за период, достаточно было бы недели затишья, чтобы владельцу вместо
    // его же цифр показали «оформите первого гостя».
    const body = await load(managerToken, '?period=7d')

    expect(body.isEmpty).toBe(false)
  })

  it('часы и дни считаются в поясе заведения, а не сервера', async () => {
    // Колонки времени объявлены как timestamp БЕЗ зоны, и в них лежит UTC.
    // Одиночный `AT TIME ZONE` над такой колонкой делает обратный перевод,
    // после чего результат начинает зависеть от настройки соединения. Здесь
    // ожидание считается тем же способом, что видит владелец, — часами его
    // заведения, — и не зависит от того, в каком поясе запущен прогон.
    const body = await load(farZoneToken)

    const localHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: FAR_ZONE,
        hour: '2-digit',
        hour12: false,
      }).format(new Date()),
    )
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: FAR_ZONE }).format(new Date())

    // «Загрузка по часам» — это средний БУДНИЙ день (docs/03, раздел 2):
    // у пляжного кафе суббота ломает картину будней, а совет про тихие часы
    // адресован именно будням.
    //
    // Значит в выходной визит в этот график не попадает ВООБЩЕ — и это не
    // дефект, а условие задачи. Раньше тест этого не учитывал и падал каждые
    // выходные; поймалось первым же прогоном в субботу.
    const localWeekday = new Intl.DateTimeFormat('en-GB', {
      timeZone: FAR_ZONE,
      weekday: 'short',
    }).format(new Date())
    const isWeekend = localWeekday === 'Sat' || localWeekday === 'Sun'

    const busy = body.hourly.filter((point) => point.guests > 0)

    if (isWeekend) {
      // Проверка не обесценивается: в выходной мы утверждаем ровно обратное —
      // что будничный график НЕ подхватил выходной визит. И заодно что он
      // всё-таки посчитался: сутки на месте, просто нулями. Без этой строки
      // ветка проходила бы и на пустом ответе.
      expect(body.hourly).toHaveLength(24)
      expect(busy).toHaveLength(0)
    } else {
      expect(busy).toHaveLength(1)
      expect(busy[0]?.hour).toBe(localHour)
    }

    // И в сегодняшнем дне по календарю заведения.
    const today = body.series.find((day) => day.date === localDate)
    expect(today).toBeDefined()
    expect(today?.new).toBe(1)
    expect(farZoneMembershipId).not.toBe('')
  })

  it('период меняет длину ряда', async () => {
    const week = await load(managerToken, '?period=7d')
    const month = await load(managerToken, '?period=30d')

    expect(week.series).toHaveLength(7)
    expect(month.series).toHaveLength(30)
    expect(month.period).toBe('30d')
  })

  it('неизвестный период отклоняется как 400, а не считается по умолчанию', async () => {
    // Молчаливый откат на 7d показал бы владельцу не тот период, который он
    // выбрал, — и цифры на экране разошлись бы с подписью под ними.
    const response = await request(server())
      .get('/v1/admin/dashboard?period=42d')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(400)

    expect(JSON.stringify(response.body)).toMatch(/VALIDATION_FAILED/)
  })

  it('кассиру дашборд закрыт', async () => {
    // Матрица прав docs/05, раздел 3: аналитика точки — менеджер и владелец.
    await request(server())
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${cashierToken}`)
      .expect(403)
  })

  it('без токена дашборд закрыт', async () => {
    await request(server()).get('/v1/admin/dashboard').expect(401)
  })
})
