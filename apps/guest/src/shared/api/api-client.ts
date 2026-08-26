import type { ZodType } from 'zod'

import { env } from '../config/env'

/** Ошибка ответа API. Текст для гостя подбирает экран, здесь — только факты. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Тонкий клиент: маршрут, заголовки, разбор ответа схемой. Бизнес-логики здесь нет
 * и не будет — она живёт в хуках экранов.
 */
export async function apiGet<T>(
  path: string,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} вернул ${response.status}`)
  }

  const payload: unknown = await response.json()

  return schema.parse(payload)
}
