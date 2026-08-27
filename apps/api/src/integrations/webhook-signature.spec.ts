import { describe, expect, it } from 'vitest'

import {
  signWebhookBody,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from './webhook-signature'

/**
 * Подпись вебхука. docs/02, раздел 4.1.
 *
 * Проверяется в отрыве от HTTP: именно здесь легко подать подпись чужой длины,
 * с лишним пробелом или из другого ключа — и именно здесь такие вещи ломаются
 * тихо, отдавая 500 вместо 401 либо, хуже, принимая чужое.
 */

const SECRET = 'whsec_тестовый_ключ_не_используется_нигде_ещё'
const NOW = 1_755_500_000
const BODY = Buffer.from(JSON.stringify({ event: 'receipt.closed', posMerchantId: 'pm_4471' }))

const validHeader = (timestamp = NOW, body = BODY, secret = SECRET): string =>
  signWebhookBody(body, secret, timestamp)

describe('Проверка подписи вебхука', () => {
  it('принимает подпись, посчитанную тем же ключом', () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      signatureHeader: validHeader(),
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    })

    expect(result.ok).toBe(true)
  })

  it('отвергает подпись, посчитанную чужим ключом', () => {
    const result = verifyWebhookSignature({
      rawBody: BODY,
      signatureHeader: validHeader(NOW, BODY, 'whsec_чужой_ключ'),
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'MISMATCH' })
  })

  it('отвергает подпись от другого тела — хоть на один байт', () => {
    // Ровно то, ради чего подпись считается по СЫРЫМ байтам: подменённая
    // сумма чека обязана ломать хеш.
    const tampered = Buffer.from(BODY.toString('utf8').replace('4471', '4472'))

    const result = verifyWebhookSignature({
      rawBody: tampered,
      signatureHeader: validHeader(),
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'MISMATCH' })
  })

  it('метка времени входит в подписываемое', () => {
    // Иначе записанный запрос переигрывается с любой свежей меткой,
    // и проверка окна становится украшением.
    const result = verifyWebhookSignature({
      rawBody: BODY,
      signatureHeader: validHeader(NOW),
      timestampHeader: String(NOW + 1),
      secret: SECRET,
      nowSeconds: NOW + 1,
    })

    expect(result).toEqual({ ok: false, reason: 'MISMATCH' })
  })

  it('отвергает запрос старше окна', () => {
    const old = NOW - TIMESTAMP_TOLERANCE_SECONDS - 1

    const result = verifyWebhookSignature({
      rawBody: BODY,
      signatureHeader: validHeader(old),
      timestampHeader: String(old),
      secret: SECRET,
      nowSeconds: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' })
  })

  it('отвергает запрос из будущего', () => {
    // Окно двустороннее: часы отправителя могут и спешить. Односторонняя
    // проверка пропустила бы запрос, датированный будущим.
    const ahead = NOW + TIMESTAMP_TOLERANCE_SECONDS + 1

    const result = verifyWebhookSignature({
      rawBody: BODY,
      signatureHeader: validHeader(ahead),
      timestampHeader: String(ahead),
      secret: SECRET,
      nowSeconds: NOW,
    })

    expect(result).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' })
  })

  it('подпись чужой длины даёт отказ, а не исключение', () => {
    // `timingSafeEqual` бросает на буферах разной длины. Незамеченное
    // исключение здесь превратилось бы в 500 вместо 401 — и заодно
    // рассказало бы отправителю, что его подпись хотя бы дошла до сравнения.
    for (const bad of ['sha256=abc', 'sha256=' + 'f'.repeat(63), 'sha256=' + 'z'.repeat(64)]) {
      expect(
        verifyWebhookSignature({
          rawBody: BODY,
          signatureHeader: bad,
          timestampHeader: String(NOW),
          secret: SECRET,
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, reason: 'MALFORMED' })
    }
  })

  it('без заголовков — отказ', () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: undefined,
        timestampHeader: String(NOW),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: 'MISSING' })

    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: validHeader(),
        timestampHeader: undefined,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: 'MISSING' })
  })

  it('метка времени не числом — отказ, а не NaN в сравнении', () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: validHeader(),
        timestampHeader: 'вчера',
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: 'TIMESTAMP_INVALID' })
  })

  it('заголовок без префикса sha256 — отказ', () => {
    const digest = validHeader().slice('sha256='.length)

    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signatureHeader: digest,
        timestampHeader: String(NOW),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: 'MALFORMED' })
  })
})
