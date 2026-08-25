/**
 * Доменные ошибки ledger.
 *
 * Формат наружу задан в docs/02_API_контракты.md, раздел 0: `code` —
 * машиночитаемый SCREAMING_SNAKE и стабильный контракт, `message` — человекочитаемый
 * и НЕ предназначенный для программной обработки, `details` — структурированные
 * подробности. Здесь живут первые два и details; requestId добавляет фильтр исключений,
 * потому что он принадлежит запросу, а не домену.
 *
 * Почему это не `HttpException` из @nestjs/common. LedgerService зовут не только
 * контроллеры: его будут звать движок правил, обработчик вебхуков POS и ночные джобы,
 * у которых HTTP нет вообще. Транспортный код (`status`) домен переносит как подсказку
 * будущему фильтру, но от фреймворка не зависит.
 *
 * Про PII (CLAUDE.md, правило 5). В `details` кладутся только идентификаторы и числа.
 * Телефон, IP, OTP-код и токен сюда не попадают никогда: details уходит и в тело ответа,
 * и в лог, а это ровно те два места, где персональных данных быть не должно.
 */

/** Коды состояния из docs/02, раздел 0. Держим числами, чтобы домен не тянул HTTP-слой. */
const STATUS = {
  /** Валидация не прошла. */
  BAD_REQUEST: 400,
  /** Не найдено ИЛИ чужой тенант. 403 подтверждал бы существование объекта — это утечка. */
  NOT_FOUND: 404,
  /** Конфликт состояния. */
  CONFLICT: 409,
  /** Бизнес-правило не выполнено. */
  UNPROCESSABLE: 422,
  /** Наша вина. */
  INTERNAL: 500,
} as const

/** Полный перечень кодов, которые может отдать core. Расширяется только осознанно. */
export const LEDGER_ERROR_CODES = [
  'LEDGER_INPUT_INVALID',
  'MEMBERSHIP_NOT_FOUND',
  'LEDGER_ENTRY_NOT_FOUND',
  'INSUFFICIENT_BALANCE',
  'IDEMPOTENCY_KEY_REUSED',
  'ALREADY_REVERSED',
  'CANNOT_REVERSE_REVERSAL',
  'BALANCE_OVERFLOW',
  'LEDGER_WRITE_CONFLICT',
  'BALANCE_DRIFT_DETECTED',
] as const

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number]

/**
 * Подробности ошибки. Тип намеренно узкий: только скаляры.
 * Произвольный `unknown` рано или поздно принёс бы сюда целый объект гостя вместе
 * с телефоном — а `details` сериализуется и в ответ, и в лог.
 */
export type LedgerErrorDetails = Readonly<Record<string, string | number | boolean | null>>

/** Общий предок всех доменных ошибок ledger. */
export abstract class LedgerError extends Error {
  /** Машиночитаемый код. Стабильный контракт для клиентов. */
  abstract readonly code: LedgerErrorCode
  /** Подсказка транспорту, какой HTTP-код показать. */
  abstract readonly status: number

  readonly details: LedgerErrorDetails

  protected constructor(message: string, details: LedgerErrorDetails = {}) {
    super(message)
    this.name = new.target.name
    this.details = details
  }
}

/** Вход не прошёл валидацию zod-схемой контракта. */
export class LedgerInputInvalidError extends LedgerError {
  override readonly code = 'LEDGER_INPUT_INVALID'
  override readonly status = STATUS.BAD_REQUEST

  /** @param issues только пути и тексты проблем — значения полей сюда не попадают. */
  constructor(operation: string, issues: string) {
    super(`Некорректный вход операции ${operation} — ${issues}`, { operation, issues })
  }
}

/**
 * Участия с таким id у этого тенанта нет.
 *
 * Тот же код отдаётся и когда membership принадлежит чужому тенанту: docs/02, раздел 0 —
 * «чужой тенант отдаёт 404, а не 403».
 */
export class MembershipNotFoundError extends LedgerError {
  override readonly code = 'MEMBERSHIP_NOT_FOUND'
  override readonly status = STATUS.NOT_FOUND

  constructor(membershipId: string) {
    super('Участие в программе не найдено', { membershipId })
  }
}

/** Записи журнала с таким id у этого тенанта нет. */
export class LedgerEntryNotFoundError extends LedgerError {
  override readonly code = 'LEDGER_ENTRY_NOT_FOUND'
  override readonly status = STATUS.NOT_FOUND

  constructor(entryId: string) {
    super('Запись журнала не найдена', { entryId })
  }
}

/**
 * Баллов не хватает.
 *
 * Бросается ВНУТРИ той же Serializable-транзакции, что и списание: проверка снаружи
 * транзакции — это гонка, в которой два параллельных списания уводят баланс в минус.
 */
export class InsufficientBalanceError extends LedgerError {
  override readonly code = 'INSUFFICIENT_BALANCE'
  override readonly status = STATUS.UNPROCESSABLE

  constructor(membershipId: string, available: number, requested: number) {
    super(`Недостаточно баллов: доступно ${available}, требуется ${requested}`, {
      membershipId,
      available,
      requested,
    })
  }
}

/**
 * Ключ идемпотентности уже использован, но операция не совпадает с первой.
 *
 * docs/02, раздел 0: «Повтор с тем же ключом, но другим телом — 409 IDEMPOTENCY_KEY_REUSED».
 * Сюда же попадает попытка переиспользовать ключ, занятый чужим тенантом.
 *
 * В details кладём то, что прислал ВЫЗЫВАЮЩИЙ, и не кладём то, что лежит в базе:
 * иначе ответ рассказывал бы про операцию соседнего мерчанта.
 */
export class IdempotencyKeyReusedError extends LedgerError {
  override readonly code = 'IDEMPOTENCY_KEY_REUSED'
  override readonly status = STATUS.CONFLICT

  constructor(operation: string, details: LedgerErrorDetails = {}) {
    super(
      `Ключ идемпотентности уже использован другой операцией (${operation}). ` +
        'Повтор возвращает первый результат только при совпадающем теле запроса.',
      { operation, ...details },
    )
  }
}

/**
 * Запись уже отменена.
 *
 * Опирается на UNIQUE по `reversalOfId`: даже если приложение проспит гонку двух
 * одновременных отмен, вторую не пустит база.
 */
export class AlreadyReversedError extends LedgerError {
  override readonly code = 'ALREADY_REVERSED'
  override readonly status = STATUS.CONFLICT

  constructor(entryId: string, reversalId?: string) {
    super('Операция уже отменена: повторная отмена не создаёт вторую компенсацию', {
      entryId,
      reversalId: reversalId ?? null,
    })
  }
}

/**
 * Нельзя отменить отмену.
 *
 * Иначе цепочка REVERSAL → REVERSAL превращается в способ начислять баллы без чека:
 * каждая следующая компенсация меняет знак предыдущей.
 */
export class CannotReverseReversalError extends LedgerError {
  override readonly code = 'CANNOT_REVERSE_REVERSAL'
  override readonly status = STATUS.UNPROCESSABLE

  constructor(entryId: string) {
    super('Компенсирующую запись отменить нельзя — заведите встречную операцию', { entryId })
  }
}

/**
 * Баланс не помещается в int4.
 *
 * `Membership.pointsBalance` и `LedgerEntry.balanceAfter` — PostgreSQL integer.
 * Переполнение упало бы внутри транзакции ошибкой драйвера 22003; понятная доменная
 * ошибка до вставки полезнее, чем «numeric field overflow» в проде.
 */
export class BalanceOverflowError extends LedgerError {
  override readonly code = 'BALANCE_OVERFLOW'
  override readonly status = STATUS.UNPROCESSABLE

  constructor(membershipId: string, attempted: number) {
    super('Баланс выходит за диапазон 32-битного целого', { membershipId, attempted })
  }
}

/**
 * Serializable-транзакция не сошлась за отведённое число попыток.
 *
 * docs/05, раздел 5: ретрай при 40001 — до трёх раз с джиттером. Если и это не помогло,
 * честнее отдать конфликт вызывающему, чем крутить цикл дальше и держать соединение.
 */
export class LedgerWriteConflictError extends LedgerError {
  override readonly code = 'LEDGER_WRITE_CONFLICT'
  override readonly status = STATUS.CONFLICT

  constructor(operation: string, attempts: number, options?: { cause?: unknown }) {
    super(
      `Операция ${operation} не завершилась за ${attempts} попыток из-за конфликта сериализации`,
      { operation, attempts },
    )

    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

/**
 * Кэш `Membership.pointsBalance` разошёлся с SUM(LedgerEntry.amount).
 *
 * docs/05, раздел 5: расхождение — алерт critical. Это не ошибка вызывающего, а наша:
 * источник истины и его кэш обязаны совпадать всегда.
 */
export class BalanceDriftDetectedError extends LedgerError {
  override readonly code = 'BALANCE_DRIFT_DETECTED'
  override readonly status = STATUS.INTERNAL

  constructor(membershipId: string, cachedBalance: number, ledgerSum: number) {
    super(`Кэш баланса разошёлся с журналом: кэш ${cachedBalance}, сумма записей ${ledgerSum}`, {
      membershipId,
      cachedBalance,
      ledgerSum,
      drift: cachedBalance - ledgerSum,
    })
  }
}

/** Отличает наши доменные ошибки от прочих — пригодится фильтру исключений. */
export const isLedgerError = (error: unknown): error is LedgerError => error instanceof LedgerError
