import { HealthResponse } from '@positive/contracts'

import { getApiUrl } from '../config/api-url'

/**
 * Какие способы входа настроены НА СЕРВЕРЕ.
 *
 * ЗАЧЕМ СПРАШИВАТЬ, А НЕ ЗАШИВАТЬ ПРИ СБОРКЕ. Кнопка входа бесполезна без
 * серверной половины: сервер, у которого нет ключа, отвергнет любую попытку.
 * Значит решать, показывать кнопку или нет, должен сервер — он единственный
 * знает правду.
 *
 * Так уже обожглись: у Google признак включённости живёт в переменной сборки,
 * и стоило один раз забыть её в сборке приложения, как кнопка исчезла молча,
 * без единой ошибки. Здесь такого не будет — источник один.
 *
 * Ответ спрашивается один раз за запуск приложения: настройки сервера не
 * меняются, пока его не перезапустят.
 */

/** Признак берётся строго по имени: неизвестный ключ — это «выключено». */
const known = (logins: Record<string, boolean>, name: string): boolean => logins[name] === true

export interface ServerLogins {
  readonly google: boolean
  readonly telegram: boolean
  readonly phone: boolean
}

/** Ничего не работает — безопасная позиция, если сервер не ответил. */
const NOTHING: ServerLogins = { google: false, telegram: false, phone: false }

/**
 * `/health` живёт вне версии API — по адресу сервера, а не по `/v1`.
 * Поэтому от настроенного адреса отрезается хвост версии.
 */
const healthUrl = (): string => `${getApiUrl().replace(/\/v\d+$/, '')}/health`

let cache: Promise<ServerLogins> | null = null

export function fetchServerLogins(): Promise<ServerLogins> {
  cache ??= fetch(healthUrl(), { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) {
        return NOTHING
      }

      const parsed = HealthResponse.safeParse(await response.json())

      if (!parsed.success) {
        return NOTHING
      }

      const logins = parsed.data.logins

      return {
        google: known(logins, 'google'),
        telegram: known(logins, 'telegram'),
        phone: known(logins, 'phone'),
      }
    })
    .catch(() => NOTHING)

  return cache
}

/** Сброс между тестами: адрес сервера в них меняется, а обещание кэшируется. */
export function resetServerLoginsCache(): void {
  cache = null
}
