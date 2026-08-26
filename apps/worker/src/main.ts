import process from 'node:process'

import { loadWorkerConfig, type WorkerConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'

/**
 * Точка входа воркера.
 *
 * Задача 1 — только каркас: конфиг, логи, корректная остановка. К Redis не подключаемся
 * и очереди (`pos-events`, `notifications`, `broadcasts`, `staff-vesting`, `expiry`,
 * `reconcile`, `wallet-sync` — docs/01, раздел 6) не регистрируем: в CI Redis нет,
 * а бизнес-логике здесь пока взяться неоткуда.
 */

const SERVICE_NAME = 'loyalty-worker'

/** Пустой процесс без таймеров и сокетов Node закрыл бы сразу — heartbeat держит цикл событий. */
const HEARTBEAT_INTERVAL_MS = 60_000

function startHeartbeat(log: Logger): NodeJS.Timeout {
  return setInterval(() => {
    log.debug('heartbeat', { queues: 0 })
  }, HEARTBEAT_INTERVAL_MS)
}

function registerShutdown(config: WorkerConfig, log: Logger, heartbeat: NodeJS.Timeout): void {
  let stopping = false

  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) {
      log.warn('shutdown already in progress', { signal })
      return
    }

    stopping = true
    log.info('shutdown requested', { signal, timeoutMs: config.shutdownTimeoutMs })

    // Страховка на будущее: когда появятся очереди, их закрытие может зависнуть на дренаже.
    // Тогда процесс всё равно обязан умереть, а Railway поднимет его заново.
    const guard = setTimeout(() => {
      log.error('graceful shutdown timed out')
      process.exit(1)
    }, config.shutdownTimeoutMs)
    guard.unref()

    // Здесь будет закрытие воркеров и соединения с Redis. Пока закрывать нечего.
    clearInterval(heartbeat)
    clearTimeout(guard)

    log.info('worker stopped', { signal })
  }

  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

function main(): void {
  const config = loadWorkerConfig(process.env)
  const log = createLogger({ level: config.logLevel, service: SERVICE_NAME })

  registerShutdown(config, log, startHeartbeat(log))

  log.info('worker ready', {
    nodeEnv: config.nodeEnv,
    concurrency: config.concurrency,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    // В лог идут только хост и порт: полная строка подключения содержит пароль.
    redisHost: config.redis.host,
    redisPort: config.redis.port,
    redisTls: config.redis.tls,
    queues: 0,
  })
}

try {
  main()
} catch (error) {
  createLogger({ level: 'error', service: SERVICE_NAME }).error('worker failed to start', {
    reason: error instanceof Error ? error.message : 'неизвестная ошибка',
  })
  process.exitCode = 1
}
