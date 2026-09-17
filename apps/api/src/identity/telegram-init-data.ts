import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Проверка данных, которые Telegram передаёт мини-приложению. docs/02, раздел 1.4.
 *
 * ЧТО ЭТО. Мини-приложение — наша же страница гостя, открытая внутри Telegram.
 * При открытии Telegram кладёт в неё строку `initData`: кто человек, когда открыл
 * и подпись. Подпись считается ключом бота, которого нет ни у кого, кроме нас
 * и Telegram, — поэтому подделать «я Вася» нельзя, не зная токен бота.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ФАЙЛ И ЧИСТАЯ ФУНКЦИЯ. Здесь решается, пускать человека
 * в чужую карту или нет. Такое проверяется юнит-тестами до последней ветки —
 * подделанная подпись, просроченная, чужой бот, поле, добавленное после подписи.
 *
 * АЛГОРИТМ — ИЗ ДОКУМЕНТАЦИИ TELEGRAM, не наш собственный:
 *   ключ   = HMAC-SHA256(данные: токен бота, ключ: "WebAppData")
 *   подпись = HMAC-SHA256(данные: строка проверки, ключ: ключ)
 * где строка проверки — все поля, кроме `hash`, отсортированные по имени
 * и склеенные через перевод строки как `имя=значение`.
 *
 * СВЕЖЕСТЬ ОБЯЗАТЕЛЬНА. Без проверки `auth_date` перехваченная строка работала бы
 * вечно: она не одноразовая. Сутки — предел Telegram для повторного открытия,
 * дальше клиент присылает новую.
 */

/** Сколько живёт подпись. Сутки: столько же, сколько её считает годной Telegram. */
const MAX_AGE_SECONDS = 24 * 60 * 60

export interface TelegramMiniAppUser {
  /** Числовой идентификатор в Telegram — он же chat id для сообщений от бота. */
  readonly id: string
  readonly displayName: string | null
  /** Язык интерфейса Telegram: «ru», «en», «th». Пусто — не сказали. */
  readonly languageCode: string | null
}

export class TelegramInitDataError extends Error {}

/**
 * Разобрать и проверить `initData`. Возвращает человека, если подпись сошлась.
 *
 * Бросает `TelegramInitDataError` с внятной причиной — причина уходит в лог,
 * а гостю наружу контроллер отдаёт один общий отказ: по тому, ЧЕМ именно плоха
 * строка, подбирать её было бы удобнее.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
): TelegramMiniAppUser {
  if (botToken.trim() === '') {
    throw new TelegramInitDataError('токен бота не задан')
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')

  if (hash === null || hash === '') {
    throw new TelegramInitDataError('в initData нет подписи')
  }

  // Строка проверки собирается из ВСЕХ полей, кроме подписи, — включая те,
  // о которых мы ничего не знаем. Иначе поле, добавленное Telegram завтра,
  // сломало бы подпись сегодня.
  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  if (!sameHex(expected, hash)) {
    throw new TelegramInitDataError('подпись не сошлась')
  }

  const authDate = Number(params.get('auth_date') ?? '')

  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new TelegramInitDataError('в initData нет времени подписи')
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - authDate

  if (ageSeconds > MAX_AGE_SECONDS) {
    throw new TelegramInitDataError(`подпись старше суток (${String(ageSeconds)} с)`)
  }

  // Часы сервера и Telegram расходятся на секунды; запас в минуту избавляет
  // от отказов «из будущего», не ослабляя проверку.
  if (ageSeconds < -60) {
    throw new TelegramInitDataError('время подписи из будущего')
  }

  return readUser(params.get('user'))
}

/** Сравнение подписей за постоянное время: длина hex-строки всегда одна. */
const sameHex = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')

  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Человек из поля `user`. Оно приходит строкой JSON — Telegram кладёт туда
 * объект целиком, и подпись считается по этой самой строке.
 */
const readUser = (raw: string | null): TelegramMiniAppUser => {
  if (raw === null || raw === '') {
    // Так бывает у мини-приложения, открытого из канала: подпись верна,
    // но человека в ней нет. Входить некому.
    throw new TelegramInitDataError('в initData нет пользователя')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TelegramInitDataError('поле user не разбирается')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new TelegramInitDataError('поле user не объект')
  }

  const user = parsed as Record<string, unknown>
  const id = user['id']

  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new TelegramInitDataError('у пользователя нет идентификатора')
  }

  const first = typeof user['first_name'] === 'string' ? user['first_name'] : ''
  const last = typeof user['last_name'] === 'string' ? user['last_name'] : ''
  const displayName = `${first} ${last}`.trim()
  const language = user['language_code']

  return {
    id: String(id),
    displayName: displayName === '' ? null : displayName,
    languageCode: typeof language === 'string' && language !== '' ? language : null,
  }
}
