import type { ZodType } from 'zod'

import { env } from '../config/env'

/**
 * Ошибка ответа API в форме единого конверта docs/02, раздел 0:
 * `{ error: { code, message } }`.
 *
 * `code` машиночитаемый — по нему ветвится экран. `message` написан сервером
 * для человека и уже локализован: показываем как есть, а не подменяем своим
 * «что-то пошло не так».
 */
export class ApiError extends Error {
  readonly code: string

  constructor(
    readonly status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

interface ErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

const toApiError = (payload: unknown, status: number, path: string): ApiError => {
  const envelope = (payload ?? {}) as ErrorEnvelope
  const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'UNKNOWN'
  const message =
    typeof envelope.error?.message === 'string'
      ? envelope.error.message
      : `Запрос ${path} вернул ${status}`

  return new ApiError(status, code, message)
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
  readonly token?: string | undefined
  readonly signal?: AbortSignal | undefined
}

/**
 * Тонкий клиент: маршрут, заголовки, разбор ответа схемой. Бизнес-логики здесь
 * нет и не будет — она живёт в хуках экранов.
 *
 * Ответ разбирается контрактной схемой, а не приводится через `as`: сервер и
 * приложение собираются из одних и тех же схем, и расхождение должно падать
 * здесь и сразу, а не превращаться в `undefined` посреди разметки.
 */
export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, token, signal } = options

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  })

  // Тело читаем и на ошибке: там конверт с кодом и человеческим текстом.
  const payload: unknown = response.status === 204 ? undefined : await response.json()

  if (!response.ok) {
    throw toApiError(payload, response.status, path)
  }

  return schema.parse(payload)
}

/** Короткая форма для чтения. */
export async function apiGet<T>(
  path: string,
  schema: ZodType<T>,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
): Promise<T> {
  return apiRequest(path, schema, { ...options, method: 'GET' })
}
