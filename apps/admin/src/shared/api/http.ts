import { API_URL } from '../config/env'

/**
 * Ошибка API в форме единого конверта docs/02, раздел 0:
 * `{ error: { code, message } }`. Код — машиночитаемый, по нему ветвится
 * обработка; message показывается человеку как есть — он уже локализован
 * и написан сервером для экрана, а не для лога.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

const readEnvelope = (payload: unknown, status: number): ApiError => {
  const envelope = (payload ?? {}) as ErrorEnvelope
  const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'UNKNOWN'
  const message =
    typeof envelope.error?.message === 'string'
      ? envelope.error.message
      : 'Сервер ответил ошибкой без описания'

  return new ApiError(status, code, message)
}

/**
 * Запрос к API. Бросает `ApiError` на любом не-2xx; сетевые сбои пролетают
 * как есть (`TypeError: fetch failed`) — TanStack Query их ретраит сам.
 */
export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  })

  // Тело читаем и на ошибке тоже: там конверт с кодом и человеческим текстом.
  const payload: unknown = response.status === 204 ? undefined : await response.json()

  if (!response.ok) {
    throw readEnvelope(payload, response.status)
  }

  return payload as T
}
