import jwt from 'jsonwebtoken'

import { AccessTokenInvalidError } from './tenant.errors'

/**
 * Разбор access-токена.
 *
 * ЧТО ЭТО СЕЙЧАС И ЧТО БУДЕТ ПОТОМ. Выпуск токенов — OTP гостю, PIN кассиру,
 * refresh — это отдельная задача Среза 1. Здесь только ПРОВЕРКА: изоляция
 * тенантов не может ждать аутентификацию, потому что без неё любой эндпоинт,
 * написанный до неё, придётся переписывать.
 *
 * Своя реализация JWT сознательно не писалась. Ручной разбор подписи — классический
 * способ получить alg=none, сравнение подписи через `===` и отсутствие проверки exp.
 * Взята зрелая библиотека, ESM-only `jose` не подошла: apps/api собирается в CommonJS.
 */

/** Алгоритм зафиксирован списком. Без этого возможна подмена alg на none или на RS256. */
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ['HS256']

/** Полезная нагрузка, на которую опирается изоляция. */
export interface AccessTokenClaims {
  readonly tenantId: string
  readonly actorId: string | null
  readonly role: string | null
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Проверяет подпись и срок, возвращает притязания.
 *
 * Бросает `AccessTokenInvalidError` на любой отказ. Наружу это должно
 * превращаться в общий `401` без деталей: разница между «просрочен» и «подпись
 * не сошлась» — это подсказка тому, кто подбирает.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  if (!isNonEmptyString(secret)) {
    // Не «пропускаем всех», а падаем: пустой секрет означает, что проверки нет вообще.
    throw new AccessTokenInvalidError('секрет подписи не сконфигурирован')
  }

  let payload: unknown
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ALLOWED_ALGORITHMS,
      // clockTolerance по умолчанию 0: расхождение часов лечится NTP, а не окном приёма.
    })
  } catch (error) {
    throw new AccessTokenInvalidError(error instanceof Error ? error.message : 'разбор не удался')
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new AccessTokenInvalidError('полезная нагрузка не является объектом')
  }

  const claims = payload as Record<string, unknown>

  if (!isNonEmptyString(claims['tenantId'])) {
    throw new AccessTokenInvalidError('в токене нет tenantId')
  }

  return {
    tenantId: claims['tenantId'],
    actorId: isNonEmptyString(claims['actorId']) ? claims['actorId'] : null,
    role: isNonEmptyString(claims['role']) ? claims['role'] : null,
  }
}

/**
 * Выпуск токена.
 *
 * Нужен тестам изоляции и локальной отладке. Настоящий выпуск — с ролями,
 * refresh и отзывом — приедет с задачей аутентификации.
 */
export function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  expiresInSeconds = 900,
): string {
  return jwt.sign({ ...claims }, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  })
}

/** Достаёт токен из заголовка. Схема ровно `Bearer`, регистр не важен. */
export function readBearerToken(header: string | undefined): string | null {
  if (!isNonEmptyString(header)) {
    return null
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}
