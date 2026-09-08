import jwt from 'jsonwebtoken'

/**
 * Токен доступа админа платформы.
 *
 * ─── ПОЧЕМУ ОТДЕЛЬНЫЙ СЕКРЕТ, А НЕ ОБЩИЙ С ОСТАЛЬНЫМИ ───────────────────────
 *
 * Это главное решение в файле, и оно про разделение контуров, а не про
 * аккуратность.
 *
 * Все нынешние токены системы — сотрудника, гостя, гостевого QR — подписаны
 * ОДНИМ секретом ACCESS_TOKEN_SECRET, а различаются формой полезной нагрузки.
 * Проверка токена сотрудника (common/tenant/access-token.ts) опознаёт его
 * попросту по наличию непустого tenantId и лишние поля игнорирует.
 *
 * Значит, будь платформенный токен подписан тем же секретом, единственным,
 * что отделяло бы его от токена владельца заведения, была бы дисциплина при
 * заполнении полей. Дисциплина не переживает рефакторинг — а цена ошибки
 * здесь: субъект, видящий все заведения, принят как субъект одного.
 *
 * С отдельным секретом такая ошибка невозможна физически. Платформенный токен,
 * предъявленный основному API, не проходит проверку подписи, а не «проходит,
 * но с не теми полями». И наоборот: токен владельца, предъявленный панели, —
 * тоже просто чужая подпись.
 *
 * ─── СЛЕДСТВИЕ ДЛЯ ЭКСПЛУАТАЦИИ ─────────────────────────────────────────────
 *
 * Секретов становится два, и второй нужен ТОЛЬКО процессу админки платформы.
 * Если PLATFORM_ACCESS_TOKEN_SECRET окажется в окружении основного API — это
 * ошибка настройки: она не даёт ему ничего полезного (таблицы платформы ему
 * всё равно недоступны на уровне прав базы), но размывает границу, ради
 * которой всё и затевалось.
 */

/** Только HS256 — как и во всех остальных токенах системы. */
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ['HS256']

/**
 * Метка контура внутри полезной нагрузки.
 *
 * Формально избыточна: чужую подпись мы и так не проверим. Оставлена
 * намеренно как второй рубеж — на случай, если однажды секреты по недосмотру
 * окажутся одинаковыми. Тогда именно она не даст токенам смешаться.
 */
const PLATFORM_KIND = 'platform'

/** 15 минут — как у владельца и админа платформы по docs/05, раздел 2. */
const DEFAULT_TTL_SECONDS = 900

export interface PlatformTokenClaims {
  readonly adminId: string
  readonly sessionId: string
}

export class PlatformTokenInvalidError extends Error {
  constructor(reason: string) {
    // Причина попадает в лог, но НЕ в ответ клиенту: по разнице формулировок
    // «просрочен» и «чужая подпись» удобно нащупывать границы.
    super(`Токен админки платформы отвергнут: ${reason}`)
    this.name = 'PlatformTokenInvalidError'
  }
}

export function signPlatformToken(
  claims: PlatformTokenClaims,
  secret: string,
  expiresInSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  return jwt.sign({ kind: PLATFORM_KIND, ...claims }, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  })
}

export function verifyPlatformToken(token: string, secret: string): PlatformTokenClaims {
  let payload: unknown

  try {
    payload = jwt.verify(token, secret, { algorithms: ALLOWED_ALGORITHMS })
  } catch {
    // Исходную ошибку не пересказываем: она различает «истёк» и «плохая подпись».
    throw new PlatformTokenInvalidError('подпись неверна или срок истёк')
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new PlatformTokenInvalidError('полезная нагрузка не является объектом')
  }

  const record = payload as Record<string, unknown>

  if (record['kind'] !== PLATFORM_KIND) {
    throw new PlatformTokenInvalidError('это токен другого контура')
  }

  const adminId = record['adminId']
  const sessionId = record['sessionId']

  if (typeof adminId !== 'string' || adminId === '') {
    throw new PlatformTokenInvalidError('в токене нет adminId')
  }

  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new PlatformTokenInvalidError('в токене нет sessionId')
  }

  return { adminId, sessionId }
}

/** Секрет подписи платформенных токенов. Отдельная переменная — см. шапку файла. */
export function platformTokenSecret(): string {
  const raw = process.env['PLATFORM_ACCESS_TOKEN_SECRET']

  if (typeof raw !== 'string' || raw.trim().length < 32) {
    throw new Error(
      'Не задан PLATFORM_ACCESS_TOKEN_SECRET (минимум 32 символа) — секрет подписи ' +
        'токенов админки платформы. Это НЕ ACCESS_TOKEN_SECRET: общий секрет на два ' +
        'контура означал бы, что токены различаются только полями, а не подписью.',
    )
  }

  return raw
}
