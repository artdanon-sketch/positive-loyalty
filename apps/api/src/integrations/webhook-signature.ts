import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Проверка подписи вебхука от кассы. docs/02, раздел 4.1.
 *
 * Вынесено отдельным файлом без зависимостей от Nest намеренно: это чистая
 * функция над байтами, и проверять её нужно в отрыве от HTTP — там, где легко
 * подать на вход подпись с лишним пробелом, чужой длины или из другого ключа.
 */

/** Допуск по времени. Больше — открывается окно для переигровки записанного запроса. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300

/** Формат заголовка: `sha256=<hex>`. */
const PREFIX = 'sha256='

export type SignatureFailure =
  'MISSING' | 'MALFORMED' | 'TIMESTAMP_INVALID' | 'TIMESTAMP_OUT_OF_WINDOW' | 'MISMATCH'

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure }

/**
 * Сверяет подпись тела запроса.
 *
 * `rawBody` — ИМЕННО СЫРЫЕ БАЙТЫ, а не разобранный и снова собранный JSON.
 * Подпись считается по тому, что отправитель послал: другой порядок ключей,
 * другие пробелы, другое представление числа — и хеш не сойдётся. Собирать
 * тело обратно из объекта означает подписывать не то, что подписывали.
 */
export function verifyWebhookSignature(input: {
  rawBody: Buffer
  signatureHeader: string | undefined
  timestampHeader: string | undefined
  secret: string
  nowSeconds: number
}): SignatureCheck {
  const { rawBody, signatureHeader, timestampHeader, secret, nowSeconds } = input

  if (signatureHeader === undefined || timestampHeader === undefined) {
    return { ok: false, reason: 'MISSING' }
  }

  if (!signatureHeader.startsWith(PREFIX)) {
    return { ok: false, reason: 'MALFORMED' }
  }

  const received = signatureHeader.slice(PREFIX.length)

  // Проверяем формат ДО сравнения: `timingSafeEqual` бросает на разной длине
  // буферов, и незамеченное исключение здесь превратилось бы в 500 вместо 401.
  if (!/^[0-9a-f]{64}$/.test(received)) {
    return { ok: false, reason: 'MALFORMED' }
  }

  const timestamp = Number(timestampHeader)

  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'TIMESTAMP_INVALID' }
  }

  // Окно двустороннее: часы отправителя могут и отставать, и спешить.
  // Односторонняя проверка пропустила бы запрос, датированный будущим.
  if (Math.abs(nowSeconds - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' }
  }

  // Метка времени входит в подписываемое: иначе записанный запрос можно
  // переиграть с любой меткой, и проверка окна станет украшением.
  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.`)
    .update(rawBody)
    .digest('hex')

  // Побайтовое сравнение за постоянное время. Обычное `===` завершается
  // на первом несовпавшем символе, и по времени ответа подпись подбирается
  // посимвольно — за считанные тысячи запросов.
  const matches = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))

  return matches ? { ok: true } : { ok: false, reason: 'MISMATCH' }
}

/** Подписывает тело тем же способом. Нужна исходящим вебхукам и тестам. */
export function signWebhookBody(rawBody: Buffer, secret: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest('hex')

  return `${PREFIX}${digest}`
}
