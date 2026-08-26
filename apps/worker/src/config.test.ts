import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONCURRENCY,
  DEFAULT_REDIS_PORT,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  loadWorkerConfig,
  WorkerConfigError,
  type WorkerEnv,
} from './config.js'

const validEnv: WorkerEnv = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  REDIS_URL: 'rediss://default:secret@eu1.upstash.io:6380',
  WORKER_CONCURRENCY: '12',
  WORKER_SHUTDOWN_TIMEOUT_MS: '30000',
}

describe('loadWorkerConfig — валидное окружение', () => {
  it('разбирает полное окружение', () => {
    const config = loadWorkerConfig(validEnv)

    expect(config).toEqual({
      nodeEnv: 'production',
      logLevel: 'warn',
      concurrency: 12,
      shutdownTimeoutMs: 30_000,
      redis: {
        url: 'rediss://default:secret@eu1.upstash.io:6380',
        host: 'eu1.upstash.io',
        port: 6380,
        tls: true,
      },
    })
  })

  it('подставляет значения по умолчанию, когда задан только REDIS_URL', () => {
    const config = loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379' })

    expect(config.nodeEnv).toBe('development')
    expect(config.logLevel).toBe('info')
    expect(config.concurrency).toBe(DEFAULT_CONCURRENCY)
    expect(config.shutdownTimeoutMs).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS)
    expect(config.redis.tls).toBe(false)
  })

  it('берёт порт Redis по умолчанию, если он не указан в URL', () => {
    const config = loadWorkerConfig({ REDIS_URL: 'redis://localhost' })

    expect(config.redis.port).toBe(DEFAULT_REDIS_PORT)
  })

  it('считает пустую строку незаданным значением', () => {
    const config = loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379', LOG_LEVEL: '' })

    expect(config.logLevel).toBe('info')
  })

  it('игнорирует посторонние ключи окружения и не мутирует вход', () => {
    const env: WorkerEnv = { ...validEnv, DATABASE_URL: 'postgresql://localhost:5432/x' }
    const snapshot = { ...env }

    expect(() => loadWorkerConfig(env)).not.toThrow()
    expect(env).toEqual(snapshot)
  })

  it('читает только переданный объект, а не process.env', () => {
    // Если бы функция подсматривала в process.env, в CI с заданным REDIS_URL тест бы прошёл молча.
    process.env.REDIS_URL = 'redis://should-not-be-used:6379'

    try {
      expect(() => loadWorkerConfig({})).toThrow(WorkerConfigError)
    } finally {
      delete process.env.REDIS_URL
    }
  })
})

describe('loadWorkerConfig — невалидное окружение', () => {
  it('падает, если REDIS_URL не задан', () => {
    expect(() => loadWorkerConfig({})).toThrow(WorkerConfigError)

    try {
      loadWorkerConfig({})
      expect.unreachable('ожидали WorkerConfigError')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerConfigError)
      expect((error as WorkerConfigError).issues.map((issue) => issue.path)).toContain('REDIS_URL')
    }
  })

  it.each([
    ['мусор вместо URL', 'localhost:6379'],
    ['чужая схема', 'https://localhost:6379'],
    ['пустая строка', ''],
  ])('падает на REDIS_URL: %s', (_name, redisUrl) => {
    expect(() => loadWorkerConfig({ REDIS_URL: redisUrl })).toThrow(WorkerConfigError)
  })

  it('не подставляет значение переменной в текст ошибки', () => {
    // Пароль намеренно из слова placeholder: строка подключения с паролем — это ровно
    // то, что ловит правило positive-loyalty-redis-url в .gitleaks.toml, а фикстура
    // с таким словом попадает под глобальный allowlist и не красит CI.
    const secret = 'redis://default:placeholder-secret-value@broken host'

    try {
      loadWorkerConfig({ REDIS_URL: secret })
      expect.unreachable('ожидали WorkerConfigError')
    } catch (error) {
      expect((error as WorkerConfigError).message).not.toContain('placeholder-secret-value')
    }
  })

  it.each([
    ['ноль', '0'],
    ['дробное', '2.5'],
    ['выше потолка', '999'],
    ['не число', 'много'],
  ])('падает на WORKER_CONCURRENCY: %s', (_name, concurrency) => {
    expect(() =>
      loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379', WORKER_CONCURRENCY: concurrency }),
    ).toThrow(WorkerConfigError)
  })

  it('падает на неизвестном LOG_LEVEL', () => {
    expect(() =>
      loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379', LOG_LEVEL: 'verbose' }),
    ).toThrow(WorkerConfigError)
  })

  it('падает на слишком коротком таймауте остановки', () => {
    expect(() =>
      loadWorkerConfig({
        REDIS_URL: 'redis://localhost:6379',
        WORKER_SHUTDOWN_TIMEOUT_MS: '100',
      }),
    ).toThrow(WorkerConfigError)
  })

  it('собирает все проблемы разом, а не только первую', () => {
    try {
      loadWorkerConfig({ REDIS_URL: 'nope', LOG_LEVEL: 'verbose' })
      expect.unreachable('ожидали WorkerConfigError')
    } catch (error) {
      const paths = (error as WorkerConfigError).issues.map((issue) => issue.path)
      expect(paths).toContain('REDIS_URL')
      expect(paths).toContain('LOG_LEVEL')
    }
  })
})
