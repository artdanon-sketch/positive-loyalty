import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signGuestQrToken } from '../../src/common/tenant/access-token'
import { PrismaService } from '../../src/core/prisma.service'
import { PosWebhookService } from '../../src/integrations/pos-webhook.service'
import { signWebhookBody } from '../../src/integrations/webhook-signature'

import { createMembershipFixture } from './ledger-test-context'

/**
 * Вебхуки от POSitive POS. docs/02, раздел 4 · docs/01, раздел 3.2.
 *
 * Проверяется то, что нарушать нельзя: подпись, окно времени, дедупликация
 * и то, что чужой ключ не открывает чужое заведение. Отдельно — что приём
 * и обработка разделены: ответ 202 не означает «баллы начислены».
 */

const SECRET = 'pos-webhook-secret-not-used-anywhere-else'

let app: INestApplication
let prisma: PrismaService
let webhooks: PosWebhookService

let tenantId: string
let guestId: string
let merchantId: string
let webhookSecret: string

/** Второе заведение со своим ключом — на нём проверяется, что ключи не общие. */
let foreignMerchantId: string
let foreignSecret: string

const server = (): Server => app.getHttpServer() as Server

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * Время в формате КАССЫ: местное со смещением, «…T19:31:05+07:00».
 *
 * Именно так выглядит пример в docs/02, раздел 4.1, и именно так шлёт касса.
 * Подставлять сюда `toISOString()` — значит проверять свой формат вместо
 * чужого: ровно на этом первый живой вебхук и упал, а тесты молчали.
 */
const posTime = (date = new Date()): string => {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  return `${shifted.toISOString().slice(0, 19)}+07:00`
}

interface EnvelopeOptions {
  readonly event?: 'receipt.closed' | 'receipt.voided'
  readonly receiptId?: string
  readonly total?: number
  readonly withGuest?: boolean
  readonly merchant?: string
}

const envelope = (options: EnvelopeOptions = {}): Record<string, unknown> => {
  const {
    event = 'receipt.closed',
    receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`,
    total = 120_000,
    withGuest = true,
    merchant = merchantId,
  } = options

  return {
    event,
    occurredAt: posTime(),
    posMerchantId: merchant,
    receipt: {
      id: receiptId,
      number: 'A-10493',
      total,
      currency: 'THB',
      paidBy: 'PROMPTPAY',
      closedAt: posTime(),
      ...(withGuest ? { loyalty: { guestToken: signGuestQrToken({ guestId }, SECRET) } } : {}),
      items: [{ sku: 'tomyum', qty: 1, price: 32_000 }],
    },
  }
}

/**
 * Отправляет подписанное событие.
 *
 * Тело передаётся ОБЪЕКТОМ, а подпись считается по `JSON.stringify` того же
 * объекта: supertest сериализует его тем же способом, и байты совпадают.
 *
 * Буфером отправлять нельзя, хотя так и хочется: `.send(Buffer)` перебивает
 * `Content-Type` на octet-stream, разборщик JSON такой запрос пропускает,
 * и сырые байты до нас не доезжают вовсе. Внешне это выглядит как «подпись
 * не сошлась» — на диагностику этого ушло больше времени, чем на сам разбор.
 */
const send = async (
  body: Record<string, unknown>,
  options: {
    secret?: string
    timestamp?: number
    idempotencyKey?: string
    signature?: string
  } = {},
): Promise<request.Response> => {
  const raw = Buffer.from(JSON.stringify(body))
  const timestamp = options.timestamp ?? nowSeconds()
  const signature =
    options.signature ?? signWebhookBody(raw, options.secret ?? webhookSecret, timestamp)

  return (
    request(server())
      .post('/v1/webhooks/pos/receipt-closed')
      .set('X-Positive-Signature', signature)
      .set('X-Positive-Timestamp', String(timestamp))
      // Заголовки принимают только ASCII: ключ собирается из длины и счётчика,
      // а не из идентификатора заведения, который в тестах бывает кириллическим.
      .set('X-Idempotency-Key', options.idempotencyKey ?? `auto-${raw.length}-${nextKey()}`)
      .send(body)
  )
}

/** Счётчик для автоключей: два одинаковых тела в разных тестах не должны слипаться. */
let keyCounter = 0
const nextKey = (): number => {
  keyCounter += 1
  return keyCounter
}

/** Ждёт, пока принятое событие будет обработано: приём и обработка разделены. */
const settle = async (eventId: string): Promise<string> => {
  for (let i = 0; i < 60; i += 1) {
    const row = await prisma.forTenant(tenantId, async (tx) =>
      tx.webhookEvent.findFirst({ where: { id: eventId, tenantId }, select: { status: true } }),
    )

    if (row !== null && row.status !== 'PENDING') {
      return row.status
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return 'PENDING'
}

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  // `rawBody: true` — ровно как в боевом bootstrap. Без него `request.rawBody`
  // пуст, подпись считается по нулю байт и не сходится НИКОГДА: все ответы
  // становятся 401, и тест выглядит как сломанная подпись вместо сломанного
  // теста. Расхождение между запуском в проде и в тесте — отдельный источник
  // ложных диагнозов, поэтому опция здесь дублируется осознанно.
  app = moduleRef.createNestApplication({ rawBody: true })
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  webhooks = moduleRef.get(PosWebhookService)

  const own = await createMembershipFixture(prisma)
  tenantId = own.tenantId
  guestId = own.guestId

  merchantId = `pm_${randomUUID().slice(0, 8)}`
  webhookSecret = `whsec_${randomUUID()}`

  await prisma.posLink.create({
    data: { tenantId, posMerchantId: merchantId, webhookSecret },
  })

  const foreign = await createMembershipFixture(prisma)
  foreignMerchantId = `pm_${randomUUID().slice(0, 8)}`
  foreignSecret = `whsec_${randomUUID()}`

  await prisma.posLink.create({
    data: {
      tenantId: foreign.tenantId,
      posMerchantId: foreignMerchantId,
      webhookSecret: foreignSecret,
    },
  })
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('Приём вебхука', () => {
  it('подписанное событие принимается кодом 202', async () => {
    const response = await send(envelope())

    // 202, а не 200: «событие принято», а не «баллы начислены» (ТЗ, раздел 4).
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ duplicate: false })
    expect(typeof (response.body as { eventId: string }).eventId).toBe('string')
  })

  it('чужим ключом чужое заведение не открывается', async () => {
    // Ключ соседа, а идентификатор наш: подпись обязана не сойтись.
    const response = await send(envelope(), { secret: foreignSecret })

    expect(response.status).toBe(401)
    expect(JSON.stringify(response.body)).toMatch(/WEBHOOK_REJECTED/)
  })

  it('незнакомый merchant отвечает тем же отказом, что и плохая подпись', async () => {
    // По разнице ответов иначе видно, существует заведение или нет,
    // и чужой posMerchantId подбирается перебором.
    const bad = await send(envelope({ merchant: 'pm_unknown_merchant' }))
    const wrongSignature = await send(envelope(), { secret: 'whsec_wrong_key' })

    expect(bad.status).toBe(401)
    expect(bad.body).toEqual(wrongSignature.body)
  })

  it('запрос старше окна отклоняется', async () => {
    const response = await send(envelope(), { timestamp: nowSeconds() - 400 })

    expect(response.status).toBe(401)
  })

  it('подпись без нужного формата не роняет сервер', async () => {
    // `timingSafeEqual` бросает на буферах разной длины: незамеченное
    // исключение дало бы 500 вместо 401.
    const response = await send(envelope(), { signature: 'sha256=short' })

    expect(response.status).toBe(401)
  })

  it('без заголовков подписи — отказ', async () => {
    const response = await request(server())
      .post('/v1/webhooks/pos/receipt-closed')
      .set('Content-Type', 'application/json')
      .send(envelope())

    expect(response.status).toBe(401)
  })

  it('повтор с тем же ключом не заводит второе событие', async () => {
    const body = envelope()
    const key = `dup-${randomUUID()}`

    const first = await send(body, { idempotencyKey: key })
    const second = await send(body, { idempotencyKey: key })

    expect(first.body).toMatchObject({ duplicate: false })
    // Повтор — нормальная работа кассы с плохой связью, а не ошибка.
    expect(second.status).toBe(202)
    expect(second.body).toMatchObject({
      duplicate: true,
      eventId: (first.body as { eventId: string }).eventId,
    })
  })
})

describe('Обработка события', () => {
  it('чек с гостем начисляет баллы по ставке заведения', async () => {
    const receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`
    const response = await send(envelope({ receiptId, total: 120_000 }))
    const eventId = (response.body as { eventId: string }).eventId

    expect(await settle(eventId)).toBe('PROCESSED')

    const entry = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findFirst({ where: { tenantId, refId: receiptId } }),
    )

    expect(entry).not.toBeNull()
    // Ставка заведения по умолчанию 5%: 1 200 ฿ → 60 ฿.
    expect(entry?.amount).toBe(6_000)
    expect(entry?.basisAmount).toBe(120_000)
    expect(entry?.source).toBe('POS_WEBHOOK')
  })

  it('время начисления берётся из чека, а не из момента доставки', async () => {
    // Вебхук опаздывает: касса работала офлайн и досылает смену вечером.
    const receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`
    const body = envelope({ receiptId })
    const closedAtInstant = new Date(Date.now() - 6 * 60 * 60 * 1000)
    ;(body['receipt'] as Record<string, unknown>)['closedAt'] = posTime(closedAtInstant)

    const response = await send(body)
    expect(await settle((response.body as { eventId: string }).eventId)).toBe('PROCESSED')

    const entry = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findFirst({ where: { tenantId, refId: receiptId } }),
    )

    // Сравниваем МОМЕНТ, а не строку: касса прислала местное время
    // со смещением, журнал хранит UTC — это одно и то же мгновение.
    expect(entry?.occurredAt?.getTime()).toBe(Math.floor(closedAtInstant.getTime() / 1000) * 1000)
  })

  it('чек без гостя принимается и помечается пропущенным, а не ошибкой', async () => {
    // Событие нужно ради доли чеков с программой — главной метрики
    // проникновения (docs/02, раздел 4.1).
    const response = await send(envelope({ withGuest: false }))

    expect(response.status).toBe(202)
    expect(await settle((response.body as { eventId: string }).eventId)).toBe('SKIPPED')
  })

  it('тот же чек, пришедший дважды разными ключами, не начисляет дважды', async () => {
    // Касса пересобрала событие и прислала с новым X-Idempotency-Key.
    // Второй рубеж — ключ идемпотентности журнала по номеру чека.
    const receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`

    const first = await send(envelope({ receiptId }), { idempotencyKey: `k1-${randomUUID()}` })
    expect(await settle((first.body as { eventId: string }).eventId)).toBe('PROCESSED')

    const second = await send(envelope({ receiptId }), { idempotencyKey: `k2-${randomUUID()}` })
    expect(await settle((second.body as { eventId: string }).eventId)).toBe('PROCESSED')

    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId, type: 'EARN' } }),
    )

    expect(entries).toHaveLength(1)
  })

  it('отмена чека кассой создаёт компенсацию', async () => {
    const receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`

    const closed = await send(envelope({ receiptId }))
    expect(await settle((closed.body as { eventId: string }).eventId)).toBe('PROCESSED')

    const voided = await send(envelope({ event: 'receipt.voided', receiptId }))
    expect(await settle((voided.body as { eventId: string }).eventId)).toBe('PROCESSED')

    const reversal = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findFirst({ where: { tenantId, refId: receiptId, type: 'REVERSAL' } }),
    )

    expect(reversal).not.toBeNull()
    // Исходная запись не тронута: журнал append-only.
    const earn = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findFirst({ where: { tenantId, refId: receiptId, type: 'EARN' } }),
    )
    expect(earn?.amount).toBe(6_000)
  })

  it('отмена неизвестного чека — пропуск, а не сбой', async () => {
    // Отменяют чек, на котором гостя не опознали: начислять было нечего,
    // отменять тоже.
    const response = await send(envelope({ event: 'receipt.voided', withGuest: false }))

    expect(await settle((response.body as { eventId: string }).eventId)).toBe('SKIPPED')
  })

  it('повторная обработка уже обработанного события ничего не меняет', async () => {
    const receiptId = `pos_rcpt_${randomUUID().slice(0, 8)}`
    const response = await send(envelope({ receiptId }))
    const eventId = (response.body as { eventId: string }).eventId

    expect(await settle(eventId)).toBe('PROCESSED')

    // Так делает восстановительный проход, наткнувшись на гонку.
    await webhooks.process(eventId, tenantId)

    const entries = await prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({ where: { tenantId, refId: receiptId, type: 'EARN' } }),
    )

    expect(entries).toHaveLength(1)
  })
})
