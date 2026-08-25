import { z } from 'zod'

import type { LogLevel } from './logger.js'

/**
 * Разбор окружения воркера.
 *
 * `loadWorkerConfig` — чистая функция: она не читает `process.env` сама, ничего не пишет
 * и никуда не подключается. Поэтому её можно гонять в тестах без Redis и без .env.
 *
 * Схема намеренно НЕ `.strict()`: на вход приходит весь `process.env`, где всегда лежат
 * посторонние ключи. Требование `.strict()` из CLAUDE.md относится к схемам запросов API,
 * где лишнее поле — это mass assignment; здесь лишние ключи просто отбрасываются.
 */

export const DEFAULT_CONCURRENCY = 5
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000
export const DEFAULT_REDIS_PORT = 6379

export interface RedisTarget {
  /** Полная строка подключения — уходит в BullMQ, но никогда в логи: в ней пароль. */
  url: string
  host: string
  port: number
  /** `rediss://` — Upstash и любой облачный Redis ходят по TLS. */
  tls: boolean
}

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production'
  logLevel: LogLevel
  /** Сколько задач воркер берёт параллельно. */
  concurrency: number
  /** Сколько ждём завершения текущих задач по SIGTERM, прежде чем выйти принудительно. */
  shutdownTimeoutMs: number
  redis: RedisTarget
}

export interface WorkerConfigIssue {
  path: string
  message: string
}

export class WorkerConfigError extends Error {
  readonly issues: readonly WorkerConfigIssue[]

  constructor(issues: readonly WorkerConfigIssue[]) {
    const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    super(`Некорректная конфигурация воркера — ${details}`)
    this.name = 'WorkerConfigError'
    this.issues = issues
  }
}

/** Пустая строка в окружении — это «не задано», а не «задано пустым». */
const withDefault = (fallback: unknown) => (value: unknown) =>
  value === undefined || value === '' ? fallback : value

const redisTargetSchema = z
  .string()
  .min(1, 'обязателен: строка подключения к Redis')
  .transform((value, ctx): RedisTarget => {
    let parsed: URL

    try {
      parsed = new URL(value)
    } catch {
      // Значение в сообщение не подставляем: в строке подключения лежит пароль.
      ctx.addIssue({ code: 'custom', message: 'не разбирается как URL' })
      return z.NEVER
    }

    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      ctx.addIssue({ code: 'custom', message: 'схема должна быть redis:// или rediss://' })
      return z.NEVER
    }

    if (parsed.hostname === '') {
      ctx.addIssue({ code: 'custom', message: 'не указан хост' })
      return z.NEVER
    }

    return {
      url: value,
      host: parsed.hostname,
      port: parsed.port === '' ? DEFAULT_REDIS_PORT : Number(parsed.port),
      tls: parsed.protocol === 'rediss:',
    }
  })

const nodeEnvSchema = z.enum(['development', 'test', 'production'])
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
const concurrencySchema = z.coerce.number().int().min(1).max(64)
const shutdownTimeoutSchema = z.coerce.number().int().min(1_000).max(120_000)

const workerEnvSchema = z.object({
  NODE_ENV: z.preprocess(withDefault('development'), nodeEnvSchema),
  LOG_LEVEL: z.preprocess(withDefault('info'), logLevelSchema),
  REDIS_URL: redisTargetSchema,
  WORKER_CONCURRENCY: z.preprocess(withDefault(DEFAULT_CONCURRENCY), concurrencySchema),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.preprocess(
    withDefault(DEFAULT_SHUTDOWN_TIMEOUT_MS),
    shutdownTimeoutSchema,
  ),
})

/** Ровно те ключи окружения, которые нужны воркеру. */
export type WorkerEnv = Readonly<Record<string, string | undefined>>

export function loadWorkerConfig(env: WorkerEnv): WorkerConfig {
  const result = workerEnvSchema.safeParse(env)

  if (!result.success) {
    throw new WorkerConfigError(
      result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.') || '(корень)',
        message: issue.message,
      })),
    )
  }

  const parsed = result.data

  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    concurrency: parsed.WORKER_CONCURRENCY,
    shutdownTimeoutMs: parsed.WORKER_SHUTDOWN_TIMEOUT_MS,
    redis: parsed.REDIS_URL,
  }
}
