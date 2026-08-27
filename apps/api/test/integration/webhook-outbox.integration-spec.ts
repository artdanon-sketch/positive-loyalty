import { randomUUID } from 'node:crypto'

import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LedgerEventsService } from '../../src/core/ledger-events.service'
import { LedgerService } from '../../src/core/ledger.service'
import { PrismaService } from '../../src/core/prisma.service'
import {
  MAX_DELIVERY_ATTEMPTS,
  WebhookOutboxService,
  type WebhookSender,
} from '../../src/integrations/webhook-outbox.service'
import { verifyWebhookSignature } from '../../src/integrations/webhook-signature'

import { createMembershipFixture, idempotencyKey } from './ledger-test-context'

/**
 * Начисление НЕ от кассы: гость получил баллы в приложении, менеджер поправил
 * баланс, сработала акция. Именно про такие изменения касса и должна узнавать.
 *
 * Общий `POS_ORIGIN` из контекста тестов здесь не подходит: у него источник
 * `POS_WEBHOOK`, то есть операция как будто пришла от самой кассы — и она
 * правильно отсеивается. На этом тесты и упали в первый прогон.
 */
const OUTSIDE_ORIGIN = { source: 'STAFF_MANUAL', actorType: 'STAFF' } as const

/** Операция, пришедшая от самой кассы: о ней ей рассказывать незачем. */
const FROM_POS_ORIGIN = { source: 'POS_WEBHOOK', actorType: 'SYSTEM' } as const

/**
 * Исходящие события к кассе. docs/02, раздел 4.3.
 *
 * Проверяется то, что нельзя увидеть глазами: что событие появляется у каждой
 * операции, что о своих же чеках кассе не рассказывают, что подпись сходится
 * той же проверкой, что и на входящих, и что повторы идут по расписанию,
 * а не бесконечно.
 *
 * Сеть подменена: настоящая отправка в тесте — источник мигания, а не проверки.
 */

/**
 * У каждого заведения СВОЙ адрес обратного вызова.
 *
 * Разгребатель по построению глобален: он не знает заранее, чьи события ждут,
 * и разбирает всю очередь разом. Значит в проход попадают и события соседних
 * тестов — это не дефект, а то, как оно работает на проде. Поэтому проверки
 * фильтруют отправленное по своему адресу, а не считают всё подряд.
 */
const callbackFor = (tenantId: string): string => `https://pos.example.test/hooks/${tenantId}`

let prisma: PrismaService
let ledger: LedgerService
let outbox: WebhookOutboxService
let close: () => Promise<void>

interface Sent {
  url: string
  body: string
  signature: string
  timestamp: number
}

/** Отправитель, который всё принимает и запоминает, что именно отправлял. */
interface Recorder extends WebhookSender {
  readonly sent: Sent[]
  /** Только то, что ушло этому заведению: очередь общая на всех. */
  readonly to: (tenantId: string) => Sent[]
}

const recorder = (ok = true): Recorder => {
  const sent: Sent[] = []

  return {
    sent,
    to: (tenantId) => sent.filter((item) => item.url === callbackFor(tenantId)),
    send: (input) => {
      sent.push(input)
      return Promise.resolve({ ok, status: ok ? 200 : 500 })
    },
  }
}

/** Заводит заведение с подключённой кассой и одного гостя в нём. */
const linkedFixture = async (
  options: { callbackUrl?: string | null } = {},
): Promise<{ tenantId: string; membershipId: string; guestId: string; secret: string }> => {
  const fixture = await createMembershipFixture(prisma)
  const secret = `whsec-${randomUUID()}`

  await prisma.posLink.create({
    data: {
      tenantId: fixture.tenantId,
      posMerchantId: `pm-${randomUUID().slice(0, 8)}`,
      webhookSecret: secret,
      callbackUrl:
        options.callbackUrl === undefined ? callbackFor(fixture.tenantId) : options.callbackUrl,
    },
  })

  return {
    tenantId: fixture.tenantId,
    membershipId: fixture.membershipId,
    guestId: fixture.guestId,
    secret,
  }
}

const earn = async (
  membershipId: string,
  tenantId: string,
  amount: number,
  origin: Record<string, unknown> = OUTSIDE_ORIGIN,
): Promise<void> => {
  await ledger.earn(
    {
      membershipId,
      amount,
      basisAmount: amount * 20,
      idempotencyKey: idempotencyKey('outbox'),
      ...origin,
    } as Parameters<LedgerService['earn']>[0],
    { tenantId },
  )
}

const deliveriesOf = async (tenantId: string): Promise<Array<Record<string, unknown>>> =>
  prisma.forTenant(tenantId, async (tx) =>
    tx.webhookDelivery.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
  )

beforeAll(async () => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [PrismaService, LedgerService, LedgerEventsService, WebhookOutboxService],
  }).compile()

  await moduleRef.init()

  prisma = moduleRef.get(PrismaService)
  ledger = moduleRef.get(LedgerService)
  outbox = moduleRef.get(WebhookOutboxService)
  close = async () => {
    await moduleRef.close()
  }
}, 60_000)

afterAll(async () => {
  await close()
})

describe('Постановка исходящих в очередь', () => {
  it('операция заводит доставку с новым балансом', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 5_000)

    await outbox.enqueuePending()

    const [delivery] = await deliveriesOf(fixture.tenantId)
    expect(delivery).toBeDefined()

    const payload = delivery?.['payload'] as { balance: number; delta: number; guestId: string }
    expect(payload.balance).toBe(5_000)
    expect(payload.delta).toBe(5_000)
    expect(payload.guestId).toBe(fixture.guestId)
  })

  it('в событии нет ни имени, ни телефона', async () => {
    const fixture = await linkedFixture()
    await prisma.guest.update({
      where: { id: fixture.guestId },
      data: { displayName: 'Анна Ковалёва' },
    })
    await earn(fixture.membershipId, fixture.tenantId, 1_000)

    await outbox.enqueuePending()

    const [delivery] = await deliveriesOf(fixture.tenantId)
    // Событие уходит в чужую систему и несёт ровно то, без чего касса
    // не покажет баланс: кого и сколько (железное правило 5).
    expect(JSON.stringify(delivery?.['payload'])).not.toContain('Ковалёва')
  })

  it('о своих же чеках кассе не рассказывают', async () => {
    const fixture = await linkedFixture()

    // Операция, пришедшая вебхуком от самой кассы: она о ней уже знает,
    // а лишнее событие — повод рассинхронизироваться.
    await earn(fixture.membershipId, fixture.tenantId, 2_000, FROM_POS_ORIGIN)

    await outbox.enqueuePending()

    expect(await deliveriesOf(fixture.tenantId)).toHaveLength(0)
  })

  it('без адреса обратного вызова очередь не копится', async () => {
    // Копить недоставляемое бессмысленно: касса не назвала, куда слать.
    const fixture = await linkedFixture({ callbackUrl: null })
    await earn(fixture.membershipId, fixture.tenantId, 3_000)

    await outbox.enqueuePending()

    expect(await deliveriesOf(fixture.tenantId)).toHaveLength(0)
  })

  it('историю до подключения кассе не выгружают', async () => {
    // Найдено живым прогоном: подключение кассы к работающему заведению
    // отправляло ей ВСЕ прошлые операции — четыреста двадцать одно событие
    // на демо-данных. `balance_changed` — подсказка для показа, а не источник
    // истины: актуальный баланс касса и так спросит при опознании гостя.
    const fixture = await linkedFixture()

    // Операция была ДО того, как касса подключилась.
    await earn(fixture.membershipId, fixture.tenantId, 6_000)
    await prisma.posLink.updateMany({
      where: { tenantId: fixture.tenantId },
      data: { linkedAt: new Date(Date.now() + 60_000) },
    })

    await outbox.enqueuePending()

    expect(await deliveriesOf(fixture.tenantId)).toHaveLength(0)
  })

  it('операции старше суток не отправляются вовсе', async () => {
    // Защита от простоя разгребателя: вернувшись через неделю, он не должен
    // выплюнуть недельную пачку неактуальных подсказок.
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 6_500)

    // Смотрим на очередь глазами послезавтрашнего дня.
    await outbox.enqueuePending(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))

    expect(await deliveriesOf(fixture.tenantId)).toHaveLength(0)
  })

  it('повторный проход не заводит вторую доставку', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 4_000)

    await outbox.enqueuePending()
    await outbox.enqueuePending()

    // Уникальный индекс по операции: вторая вставка упирается в базу,
    // а не в удачу.
    expect(await deliveriesOf(fixture.tenantId)).toHaveLength(1)
  })
})

describe('Отправка исходящих', () => {
  it('подпись сходится той же проверкой, что и на входящих', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 7_000)

    const sender = recorder()
    outbox.sender = sender

    await outbox.tick()

    const sent = sender.to(fixture.tenantId)[0]
    expect(sent).toBeDefined()

    // Одна функция на оба направления — значит и ломаться будет в одном месте.
    const check = verifyWebhookSignature({
      rawBody: Buffer.from(sent?.body ?? ''),
      signatureHeader: sent?.signature,
      timestampHeader: String(sent?.timestamp),
      secret: fixture.secret,
      nowSeconds: sent?.timestamp ?? 0,
    })

    expect(check.ok).toBe(true)
  })

  it('успешная отправка помечает доставку и не повторяется', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 8_000)

    const sender = recorder()
    outbox.sender = sender

    await outbox.tick()
    await outbox.tick()

    expect(sender.to(fixture.tenantId)).toHaveLength(1)
    const [delivery] = await deliveriesOf(fixture.tenantId)
    expect(delivery?.['status']).toBe('DELIVERED')
  })

  it('отказ кассы откладывает повтор, а не сжигает попытки подряд', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 9_000)

    const sender = recorder(false)
    outbox.sender = sender

    const now = new Date()
    await outbox.tick(now)

    const [afterFirst] = await deliveriesOf(fixture.tenantId)
    expect(afterFirst?.['attempts']).toBe(1)
    expect(afterFirst?.['status']).toBe('PENDING')

    // Второй проход В ТОТ ЖЕ МОМЕНТ ничего не отправляет: время не пришло.
    // Без этого расписание повторов 1с, 5с, 30с… не значило бы ничего.
    await outbox.tick(now)
    expect(sender.to(fixture.tenantId)).toHaveLength(1)

    // А когда пауза вышла — отправляет.
    await outbox.tick(new Date(now.getTime() + 2_000))
    expect(sender.to(fixture.tenantId)).toHaveLength(2)
  })

  it('после исчерпания попыток доставка признаётся несостоявшейся', async () => {
    const fixture = await linkedFixture()
    await earn(fixture.membershipId, fixture.tenantId, 10_000)

    const sender = recorder(false)
    outbox.sender = sender

    let now = new Date()

    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await outbox.tick(now)
      // Уводим часы далеко вперёд: следующая пауза всегда меньше суток.
      now = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    }

    const [delivery] = await deliveriesOf(fixture.tenantId)
    expect(delivery?.['status']).toBe('FAILED')
    expect(sender.to(fixture.tenantId)).toHaveLength(MAX_DELIVERY_ATTEMPTS)

    // Дальше не дёргаем: разбирать провал должен человек, а не бесконечный
    // фоновый повтор.
    await outbox.tick(now)
    expect(sender.to(fixture.tenantId)).toHaveLength(MAX_DELIVERY_ATTEMPTS)
  })

  it('чужие события в очередь заведения не попадают', async () => {
    const own = await linkedFixture()
    const foreign = await linkedFixture()

    await earn(own.membershipId, own.tenantId, 1_100)
    await earn(foreign.membershipId, foreign.tenantId, 2_200)

    await outbox.enqueuePending()

    const ownDeliveries = await deliveriesOf(own.tenantId)
    expect(ownDeliveries).toHaveLength(1)
    expect((ownDeliveries[0]?.['payload'] as { delta: number }).delta).toBe(1_100)
  })
})
