import process from 'node:process'

/**
 * Крошечный структурированный логгер: одна JSON-строка на событие в stdout.
 * Вывод через глобальный console в репозитории запрещён (CLAUDE.md),
 * поэтому пишем прямо в поток.
 *
 * Железное правило 5: PII в логи не попадает. Здесь маскировать пока нечего —
 * воркер логирует только собственное состояние. Когда появятся реальные задачи
 * с телефонами и токенами, маскирование должно жить в этом модуле (в транспорте),
 * а не в местах вызова.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

export interface LoggerOptions {
  /** Порог: события ниже уровня не пишутся. */
  level: LogLevel
  /** Попадает в поле `service` каждой строки. */
  service: string
  /** Поток вывода. По умолчанию stdout; в тестах удобно подменить. */
  stream?: NodeJS.WritableStream
}

export function createLogger(options: LoggerOptions): Logger {
  const stream = options.stream ?? process.stdout
  const threshold = LEVEL_ORDER[options.level]

  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) {
      return
    }

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: options.service,
      msg: message,
      ...fields,
    })

    stream.write(`${line}\n`)
  }

  return {
    debug: (message, fields) => {
      write('debug', message, fields)
    },
    info: (message, fields) => {
      write('info', message, fields)
    },
    warn: (message, fields) => {
      write('warn', message, fields)
    },
    error: (message, fields) => {
      write('error', message, fields)
    },
  }
}
