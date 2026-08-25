import { z } from 'zod'

/**
 * Ответ health-check API: `GET /health`.
 *
 * Живёт вне префикса `/v1`: на этот путь смотрит healthcheck Railway, и он не должен
 * переезжать вместе с версией API.
 *
 * `.strict()` обязателен по CLAUDE.md — без него лишние поля молча проходят
 * валидацию и открывают mass assignment.
 */
export const HealthResponse = z
  .object({
    /** Единственное допустимое значение: сервис либо жив, либо не отвечает вовсе. */
    status: z.literal('ok'),
    /** Имя сервиса, например `api`. Нужно, когда за одним доменом их несколько. */
    service: z.string().min(1),
    /** Версия сборки, например `0.0.0`. */
    version: z.string().min(1),
    /** Аптайм процесса в целых секундах. */
    uptimeSeconds: z.number().int().nonnegative(),
    /** Момент ответа в ISO-8601 — по нему видно, не отдаёт ли балансировщик кэш. */
    timestamp: z.iso.datetime(),
  })
  .strict()

export type HealthResponse = z.infer<typeof HealthResponse>
