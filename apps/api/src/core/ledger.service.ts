import { Injectable, Logger } from '@nestjs/common'
import {
  EarnInput,
  RedeemInput,
  ReverseInput,
  LedgerOperationResult,
  type ActorType,
  type LedgerSource,
  type LedgerType,
} from '@positive/contracts'
import { z } from 'zod'

import { Prisma } from '../generated/prisma/client'
import type { LedgerEntry } from '../generated/prisma/client'

import { reconcileMembershipBalance, type BalanceReconciliation } from './balance'
import {
  AlreadyReversedError,
  BalanceOverflowError,
  CannotReverseReversalError,
  IdempotencyKeyReusedError,
  InsufficientBalanceError,
  LedgerEntryNotFoundError,
  LedgerFutureEventError,
  LedgerInputInvalidError,
  LedgerWriteConflictError,
  MembershipNotFoundError,
} from './ledger.errors'
import { PrismaService } from './prisma.service'

/**
 * LedgerService — единственное место в системе, где меняются баллы.
 *
 * Железное правило 1 (CLAUDE.md): `Membership.pointsBalance` — производная от журнала,
 * а не самостоятельное поле. Любой `prisma.membership.update` с `pointsBalance` вне
 * этого файла — баг, а не «оптимизация».
 *
 * Эталонная реализация earn приведена в docs/01, раздел 4.4. Здесь она доведена до
 * состояния, в котором её можно ставить на кассу: добавлены проверка тенанта,
 * ретрай на конфликте сериализации, обработка гонки по ключу идемпотентности,
 * защита от отрицательного баланса и от переполнения int4.
 *
 * Четыре свойства, которые обязаны выполняться и которые проверяются тестами Задачи 2:
 *
 * 1. ИДЕМПОТЕНТНОСТЬ. Повтор с тем же ключом возвращает ПЕРВУЮ запись, а не создаёт
 *    вторую операцию. Проверки «поискали и не нашли» мало: два параллельных запроса
 *    проходят её одновременно. Настоящая гарантия — UNIQUE на `idempotencyKey`;
 *    нарушение (P2002) здесь не пробрасывается наверх, а превращается в повтор.
 * 2. SERIALIZABLE С РЕТРАЕМ. Без `Serializable` два параллельных начисления на один
 *    membership дают потерянное обновление. С ним Postgres штатно отдаёт 40001
 *    (Prisma: P2034), и транзакцию НАДО повторить — иначе тест на гонку мигает.
 * 3. БАЛАНС НЕ УХОДИТ В МИНУС. Достаточность баллов проверяется ВНУТРИ той же
 *    транзакции, что и списание.
 * 4. КЭШ РАВЕН ЖУРНАЛУ. `pointsBalance` пишется только вместе с ledger-записью и
 *    всегда равен `balanceAfter` последней записи.
 */

/** docs/05, раздел 5: «Ретрай при 40001 — до трёх раз с джиттером». */
const RETRY_LIMIT = 3
const MAX_ATTEMPTS = RETRY_LIMIT + 1

/**
 * Пауза перед повтором: экспонента с полным джиттером, чтобы конкуренты разъехались.
 *
 * База 50, а не 15. При базе 15 потолок был НЕДОСТИЖИМ: три разрешённые ТЗ
 * попытки давали ceiling 15, 30 и 60 мс, то есть `RETRY_MAX_DELAY_MS` не
 * участвовал в расчёте вовсе, а полный джиттер делил и эти числа пополам —
 * фактическое ожидание составляло десятки миллисекунд.
 *
 * Этого мало ровно тогда, когда ретрай и нужен. Транзакция начисления на
 * загруженной машине идёт дольше, чем длилась пауза, поэтому повтор просыпался
 * прямо в работающего конкурента и конфликтовал снова. Два параллельных
 * начисления — не «плотная конкуренция», а обычный день на кассе, и они обязаны
 * укладываться в отведённые попытки.
 *
 * Число попыток не тронуто: «ретрай при 40001 — до трёх раз с джиттером»
 * задано docs/05, раздел 5. Изменился только размах паузы, и теперь потолок
 * из того же раздела действительно достигается на третьей попытке.
 */
const RETRY_BASE_DELAY_MS = 50
const RETRY_MAX_DELAY_MS = 200

/**
 * Транзакция короткая: чтение membership, вставка строки, обновление кэша.
 * Потолок выше значения по умолчанию (5 с) с запасом на повтор под нагрузкой,
 * но не настолько, чтобы зависшая транзакция держала соединение полчаса.
 */
const TRANSACTION_TIMEOUT_MS = 10_000
const TRANSACTION_MAX_WAIT_MS = 5_000

/** `Membership.pointsBalance` и `LedgerEntry.balanceAfter` — PostgreSQL integer (int4). */
const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648

/** Коды PostgreSQL, при которых транзакцию положено повторить. */
const PG_SERIALIZATION_FAILURE = '40001'
const PG_DEADLOCK_DETECTED = '40P01'

/** Нарушение UNIQUE в терминах самого PostgreSQL — если Prisma не успела его завернуть. */
const PG_UNIQUE_VIOLATION = '23505'

/** Коды Prisma. P2034 — «transaction failed due to a write conflict or a deadlock». */
const PRISMA_TRANSACTION_CONFLICT = 'P2034'
const PRISMA_UNIQUE_VIOLATION = 'P2002'

/**
 * Prisma 7 с driver adapter НЕ пробрасывает код PostgreSQL наверх.
 *
 * `@prisma/adapter-pg` переводит SQLSTATE в собственную таксономию (dist/index.mjs,
 * `convertDriverError`): case '40001' превращается в `{ kind: 'TransactionWriteConflict' }`,
 * и код 40001 при этом ТЕРЯЕТСЯ. Дальше `DriverAdapterError` (пакет
 * `@prisma/driver-adapter-utils`) кладёт этот объект в `cause`, а сообщением берёт
 * `payload.kind`, потому что поля `message` в нём нет:
 *
 *     class DriverAdapterError extends Error {
 *       constructor(payload) {
 *         super(typeof payload['message'] === 'string' ? payload['message'] : payload.kind)
 *         this.cause = payload
 *       }
 *     }
 *
 * Итог: у ошибки нет ни `code`, ни текста «could not serialize access» — только
 * `cause.kind`. Проверка по кодам и по тексту её не видит, ретрай не срабатывает,
 * и конфликт сериализации вылетает наружу как отказ операции.
 *
 * Поймано не рассуждением, а прогоном: тест «параллельные начисления на разные
 * участия» падал с `DriverAdapterError: TransactionWriteConflict`.
 */
const ADAPTER_RETRYABLE_KINDS = new Set(['TransactionWriteConflict'])

/** Драйвер иногда отдаёт текст без кода — последний рубеж распознавания конфликта. */
const SERIALIZATION_MESSAGE =
  /could not serialize access|deadlock detected|TransactionWriteConflict/i

type TransactionClient = Prisma.TransactionClient

/**
 * Тенант операции.
 *
 * Отдельный аргумент, а не поле входной схемы, и это принципиально: во входных
 * контрактах `tenantId` нет намеренно (см. комментарий в packages/contracts/src/ledger.ts),
 * иначе касса могла бы передать чужой tenantId телом запроса. Значение приходит из JWT —
 * сейчас его подставляет вызывающий, после Задачи 3 это будет `TenantContext.get()`
 * поверх AsyncLocalStorage (CLAUDE.md, железное правило 2).
 */
export interface TenantScope {
  readonly tenantId: string
}

/**
 * Чем повтор обязан совпасть с первой операцией.
 *
 * docs/02, раздел 0: «Повтор с тем же ключом, но другим телом — 409 IDEMPOTENCY_KEY_REUSED».
 * Сравниваем не всё тело, а материальные поля — те, из-за расхождения которых деньги
 * встают не туда: тенант, тип, участие и сумму.
 */
interface ReplayExpectation {
  readonly type: LedgerType
  readonly membershipId?: string
  readonly amount?: number
  readonly reversalOfId?: string
}

interface CommitParams {
  readonly operation: string
  readonly idempotencyKey: string
  readonly tenantId: string
  readonly expectation: ReplayExpectation
  readonly write: (tx: TransactionClient) => Promise<LedgerEntry>
}

/** Поля происхождения, общие для earn, redeem и reverse. */
interface OriginInput {
  readonly source: LedgerSource
  readonly actorType: ActorType
  readonly actorId?: string
  readonly locationId?: string
  readonly deviceId?: string
  readonly ip?: string
}

/**
 * Разворачивает поля происхождения в колонки.
 *
 * `undefined` превращается в `null` явно: у Prisma это разные вещи — пропущенное поле
 * и записанный NULL, — и в append-only журнале «поля просто нет» быть не должно.
 */
const originColumns = (
  input: OriginInput,
): {
  source: LedgerSource
  actorType: ActorType
  actorId: string | null
  locationId: string | null
  deviceId: string | null
  ip: string | null
} => ({
  source: input.source,
  actorType: input.actorType,
  actorId: input.actorId ?? null,
  locationId: input.locationId ?? null,
  deviceId: input.deviceId ?? null,
  // PII. В журнале нужен антифроду, в логах не появляется никогда.
  ip: input.ip ?? null,
})

/** Только пути и тексты проблем: значения полей в сообщение не попадают (там бывает телефон). */
const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const key = issue.path.join('.')
      return key.length > 0 ? `${key}: ${issue.message}` : issue.message
    })
    .join('; ')

/**
 * Проверяет вход схемой из контрактов.
 *
 * Да, на HTTP-границе уже отработал ZodValidationPipe. Но LedgerService зовут не только
 * контроллеры: движок правил, обработчик вебхуков POS и джобы приходят сюда напрямую,
 * мимо всякого пайпа. Деньги — не то место, где стоит доверять вызывающему на слово.
 */
const parseInput = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  operation: string,
): z.infer<Schema> => {
  const parsed = schema.safeParse(value)

  if (!parsed.success) {
    throw new LedgerInputInvalidError(operation, describeIssues(parsed.error))
  }

  return parsed.data
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Полный джиттер: без него все конкуренты просыпаются одновременно и конфликтуют снова. */
const backoffDelayMs = (attempt: number): number => {
  const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
  return Math.round(Math.random() * ceiling)
}

/** Достаёт код ошибки PostgreSQL из того, что отдал драйвер (у pg он лежит в `code`). */
const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * `kind` из таксономии driver adapter. Лежит либо прямо на объекте (когда мы уже
 * провалились в `cause`), либо в `cause` самой `DriverAdapterError`.
 */
const readErrorKind = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const own: unknown = (error as { kind?: unknown }).kind
  if (typeof own === 'string') {
    return own
  }

  const cause: unknown = (error as { cause?: unknown }).cause
  if (typeof cause !== 'object' || cause === null) {
    return undefined
  }

  const nested: unknown = (cause as { kind?: unknown }).kind
  return typeof nested === 'string' ? nested : undefined
}

const readErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Конфликт сериализации — это НЕ сбой, а штатный ответ Serializable.
 *
 * Prisma нормализует его в P2034, но с driver adapter ошибка приходит в разных видах:
 * иногда `PrismaClientKnownRequestError`, иногда сырая ошибка pg с кодом 40001/40P01,
 * иногда — только текстом. Проверяем все формы, включая одну вложенность `cause`:
 * пропущенный конфликт превращает тест на гонку в мигающий, а это худший вид красного.
 *
 * Опираться на один `instanceof` нельзя: при двух копиях @prisma/client в дереве
 * зависимостей классы разные, и проверка молча перестанет срабатывать — а вместе
 * с ней и весь ретрай.
 */
const isRetryableTransactionError = (error: unknown, depth = 0): boolean => {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : readErrorCode(error)

  if (
    code === PRISMA_TRANSACTION_CONFLICT ||
    code === PG_SERIALIZATION_FAILURE ||
    code === PG_DEADLOCK_DETECTED
  ) {
    return true
  }

  // Таксономия driver adapter: кода нет, есть только kind. См. комментарий выше.
  const kind = readErrorKind(error)
  if (kind !== undefined && ADAPTER_RETRYABLE_KINDS.has(kind)) {
    return true
  }

  // Известная ошибка Prisma с другим кодом — это не конфликт, дальше не гадаем.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return false
  }

  if (SERIALIZATION_MESSAGE.test(readErrorMessage(error))) {
    return true
  }

  if (depth === 0 && error instanceof Error && error.cause !== undefined) {
    return isRetryableTransactionError(error.cause, depth + 1)
  }

  return false
}

/**
 * Нарушение UNIQUE. Какого именно индекса — разбираем отдельно, по факту в базе:
 * `meta.target` приезжает от драйвера то массивом полей, то именем ограничения.
 */
const isUniqueViolation = (error: unknown): boolean => {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : readErrorCode(error)

  return code === PRISMA_UNIQUE_VIOLATION || code === PG_UNIQUE_VIOLATION
}

/**
 * Складывает баллы с проверкой диапазона int4.
 *
 * Переполнение упало бы уже внутри транзакции ошибкой драйвера 22003 —
 * после того, как транзакция начала работу. Понятная доменная ошибка до вставки дешевле.
 */
const shiftBalance = (current: number, delta: number, membershipId: string): number => {
  const next = current + delta

  if (next > INT32_MAX || next < INT32_MIN) {
    throw new BalanceOverflowError(membershipId, next)
  }

  return next
}

/** Что сверке и записи нужно знать об участии. */
const MEMBERSHIP_SELECT = {
  id: true,
  tenantId: true,
  guestId: true,
  pointsBalance: true,
  visitsTotal: true,
  spentTotal: true,
  firstVisitAt: true,
  // Нужен, чтобы догрузка опоздавшей смены не откатывала дату последнего
  // визита назад: гость, побывавший позже, не должен становиться «спящим».
  lastVisitAt: true,
  tenant: { select: { currency: true } },
} as const

/**
 * Читает участие в границах тенанта.
 *
 * Фильтр по `tenantId` здесь — это и есть кросс-тенантная защита: `findFirst` вместо
 * `findUnique` именно затем, чтобы чужое участие не находилось вовсе. Отсюда 404
 * MEMBERSHIP_NOT_FOUND, а не 403: docs/02, раздел 0 — «403 подтверждает существование
 * объекта и является утечкой».
 */
const loadMembership = async (
  tx: TransactionClient,
  membershipId: string,
  tenantId: string,
): Promise<Prisma.MembershipGetPayload<{ select: typeof MEMBERSHIP_SELECT }>> => {
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, tenantId },
    select: MEMBERSHIP_SELECT,
  })

  if (membership === null) {
    throw new MembershipNotFoundError(membershipId)
  }

  return membership
}

/** Приводит строку журнала к контракту `LedgerOperationResult` из packages/contracts. */
const buildResult = (row: LedgerEntry, replayed: boolean): LedgerOperationResult =>
  LedgerOperationResult.parse({
    entry: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      occurredAt: row.occurredAt === null ? null : row.occurredAt.toISOString(),
    },
    replayed,
  })

/**
 * Время события, если оно отличается от времени записи.
 *
 * Сервис проверяет ровно один запрет — БУДУЩЕЕ. Чек не может произойти позже,
 * чем о нём узнали: это либо сбитые часы кассы, либо попытка занести покупку
 * в акцию, которая ещё не началась. И то и другое лечится отказом, а не
 * молчаливым сдвигом.
 *
 * Насколько далеко назад разрешено датировать — вопрос ГРАНИЦЫ, а не журнала:
 * величина окна опоздания зависит от интеграции, и проверяет её контракт того
 * эндпоинта, который принимает вебхук. Интерфейсу кассира это поле не даётся
 * вовсе — возможность датировать чек задним числом в руках кассира означает
 * возможность занести покупку в окно закончившейся акции.
 *
 * Небольшой допуск вперёд оставлен намеренно: часы кассы и часы сервера
 * расходятся на секунды, и отказывать из-за этого — значит терять чеки.
 */
const FUTURE_TOLERANCE_MS = 60_000

/** Раньше из двух; если первой нет — вторая. Для `firstVisitAt`. */
const earliest = (current: Date | null, candidate: Date): Date =>
  current === null || candidate < current ? candidate : current

/** Позже из двух. Для `lastVisitAt`: догрузка старой смены не откатывает её назад. */
const latest = (current: Date | null, candidate: Date): Date =>
  current === null || candidate > current ? candidate : current

const resolveOccurredAt = (raw: string | undefined, now: Date): Date | null => {
  if (raw === undefined) {
    return null
  }

  const occurredAt = new Date(raw)

  if (occurredAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new LedgerFutureEventError(occurredAt, now)
  }

  return occurredAt
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Начисление баллов.
   *
   * `amount: 0` разрешён сознательно: гость из контрольной группы визит совершает,
   * баллов не получает, но `visitsTotal` и `spentTotal` обязаны сдвинуться — иначе
   * эффект программы доказать будет нечем. Решение «начислять или нет» принимает
   * движок правил, ledger только исполняет.
   */
  async earn(input: EarnInput, scope: TenantScope): Promise<LedgerOperationResult> {
    const parsed = parseInput(EarnInput, input, 'earn')

    return this.commit({
      operation: 'earn',
      idempotencyKey: parsed.idempotencyKey,
      tenantId: scope.tenantId,
      expectation: { type: 'EARN', membershipId: parsed.membershipId, amount: parsed.amount },
      write: async (tx) => {
        const membership = await loadMembership(tx, parsed.membershipId, scope.tenantId)
        const balanceAfter = shiftBalance(membership.pointsBalance, parsed.amount, membership.id)
        const now = new Date()
        const occurredAt = resolveOccurredAt(parsed.occurredAt, now)
        // Время визита — событие, если оно названо, иначе момент записи.
        const visitedAt = occurredAt ?? now

        const row = await tx.ledgerEntry.create({
          data: {
            tenantId: membership.tenantId,
            guestId: membership.guestId,
            membershipId: membership.id,
            type: 'EARN',
            amount: parsed.amount,
            balanceAfter,
            basisAmount: parsed.basisAmount ?? null,
            // Валюта принадлежит тенанту: контракт разрешает не передавать её.
            currency: parsed.currency ?? membership.tenant.currency,
            refType: parsed.refType ?? null,
            refId: parsed.refId ?? null,
            idempotencyKey: parsed.idempotencyKey,
            offerId: parsed.offerId ?? null,
            occurredAt,
            ...originColumns(parsed),
          },
        })

        // Кэш баланса пишется ЗДЕСЬ — в той же транзакции, что и строка журнала.
        // Никакого второго места в кодовой базе для этого update быть не должно.
        await tx.membership.update({
          where: { id: membership.id },
          data: {
            pointsBalance: balanceAfter,
            visitsTotal: { increment: 1 },
            spentTotal: { increment: parsed.basisAmount ?? 0 },
            // Даты визитов — про СОБЫТИЕ, а не про запись: опоздавший вебхук
            // не должен делать вчерашний обед сегодняшним визитом.
            firstVisitAt: earliest(membership.firstVisitAt, visitedAt),
            // lastVisitAt не откатываем назад: догрузка старой смены не делает
            // гостя «давно не заходившим», если после неё он уже был.
            lastVisitAt: latest(membership.lastVisitAt, visitedAt),
          },
        })

        return row
      },
    })
  }

  /**
   * Списание баллов.
   *
   * В журнал уходит отрицательный `amount`: знак ставит сервис, а не вызывающий.
   * Если бы вход принимал знаковое число, рано или поздно кто-нибудь передал бы модуль,
   * и списание молча превратилось бы в начисление.
   *
   * Счётчики визитов и оборота списание не трогает: их двигает начисление по тому же
   * чеку, и второй инкремент посчитал бы один визит дважды.
   */
  async redeem(input: RedeemInput, scope: TenantScope): Promise<LedgerOperationResult> {
    const parsed = parseInput(RedeemInput, input, 'redeem')

    return this.commit({
      operation: 'redeem',
      idempotencyKey: parsed.idempotencyKey,
      tenantId: scope.tenantId,
      expectation: { type: 'REDEEM', membershipId: parsed.membershipId, amount: -parsed.amount },
      write: async (tx) => {
        const membership = await loadMembership(tx, parsed.membershipId, scope.tenantId)

        // Проверка достаточности — ВНУТРИ транзакции. Снаружи она бесполезна:
        // между чтением баланса и вставкой пролезает второе списание.
        if (membership.pointsBalance < parsed.amount) {
          throw new InsufficientBalanceError(membership.id, membership.pointsBalance, parsed.amount)
        }

        const balanceAfter = shiftBalance(membership.pointsBalance, -parsed.amount, membership.id)

        const row = await tx.ledgerEntry.create({
          data: {
            tenantId: membership.tenantId,
            guestId: membership.guestId,
            membershipId: membership.id,
            type: 'REDEEM',
            amount: -parsed.amount,
            balanceAfter,
            basisAmount: parsed.basisAmount ?? null,
            currency: parsed.currency ?? membership.tenant.currency,
            refType: parsed.refType ?? null,
            refId: parsed.refId ?? null,
            idempotencyKey: parsed.idempotencyKey,
            offerId: parsed.offerId ?? null,
            occurredAt: resolveOccurredAt(parsed.occurredAt, new Date()),
            ...originColumns(parsed),
          },
        })

        await tx.membership.update({
          where: { id: membership.id },
          data: { pointsBalance: balanceAfter },
        })

        return row
      },
    })
  }

  /**
   * Компенсация ранее проведённой операции.
   *
   * Исходная запись НЕ правится — это запрещено и правилом, и базой: UPDATE на
   * `LedgerEntry` снят с ролей и заблокирован триггером (см. миграцию init_ledger_core).
   * Отмена — новая строка типа REVERSAL с обратным знаком и заполненным `reversalOfId`.
   *
   * Сумму компенсации вызывающий не передаёт: она читается из исходной записи внутри
   * той же транзакции. Иначе появился бы способ «отменить 500 из начисленных 200».
   *
   * Повторная отмена отклоняется дважды: явной проверкой и UNIQUE по `reversalOfId`.
   * Проверка ловит обычный случай, UNIQUE — гонку двух одновременных отмен.
   */
  async reverse(input: ReverseInput, scope: TenantScope): Promise<LedgerOperationResult> {
    const parsed = parseInput(ReverseInput, input, 'reverse')

    try {
      return await this.commit({
        operation: 'reverse',
        idempotencyKey: parsed.idempotencyKey,
        tenantId: scope.tenantId,
        expectation: { type: 'REVERSAL', reversalOfId: parsed.entryId },
        write: async (tx) => {
          const original = await tx.ledgerEntry.findFirst({
            where: { id: parsed.entryId, tenantId: scope.tenantId },
          })

          if (original === null) {
            throw new LedgerEntryNotFoundError(parsed.entryId)
          }

          if (original.type === 'REVERSAL') {
            throw new CannotReverseReversalError(parsed.entryId)
          }

          const existingReversal = await tx.ledgerEntry.findUnique({
            where: { reversalOfId: parsed.entryId },
            select: { id: true },
          })

          if (existingReversal !== null) {
            throw new AlreadyReversedError(parsed.entryId, existingReversal.id)
          }

          const membership = await loadMembership(tx, original.membershipId, scope.tenantId)
          const amount = -original.amount
          const balanceAfter = shiftBalance(membership.pointsBalance, amount, membership.id)

          // Отмена начисления после того, как баллы уже потрачены (docs/05, схема 6.6).
          // Баланс в минус не уводим: политика «уводить в минус / обнулять» принадлежит
          // ProgramConfig и приедет вместе с движком правил, а не решается кассиром.
          if (balanceAfter < 0) {
            throw new InsufficientBalanceError(membership.id, membership.pointsBalance, -amount)
          }

          const row = await tx.ledgerEntry.create({
            data: {
              tenantId: original.tenantId,
              guestId: original.guestId,
              membershipId: original.membershipId,
              type: 'REVERSAL',
              amount,
              balanceAfter,
              // Ссылка на чек и валюта наследуются от исходной записи: компенсация
              // должна находиться по тому же refId, что и то, что она отменяет.
              basisAmount: original.basisAmount,
              currency: original.currency,
              refType: original.refType,
              refId: original.refId,
              idempotencyKey: parsed.idempotencyKey,
              reversalOfId: original.id,
              offerId: original.offerId,
              ...originColumns(parsed),
            },
          })

          await tx.membership.update({
            where: { id: membership.id },
            data: {
              pointsBalance: balanceAfter,
              // Начисление двигало счётчики визита — компенсация возвращает их назад.
              // Ниже нуля не опускаемся: чужой визит отменой не «съедается».
              ...(original.type === 'EARN'
                ? {
                    visitsTotal: Math.max(0, membership.visitsTotal - 1),
                    spentTotal: Math.max(0, membership.spentTotal - (original.basisAmount ?? 0)),
                  }
                : {}),
            },
          })

          return row
        },
      })
    } catch (error) {
      // Ключ идемпотентности уже разобран в commit(); значит, гонку проиграл UNIQUE
      // по reversalOfId — эту операцию отменил кто-то другой, пока мы писали.
      if (isUniqueViolation(error)) {
        throw new AlreadyReversedError(parsed.entryId)
      }

      throw error
    }
  }

  /**
   * Сверка кэша баланса с журналом для одного участия.
   *
   * Нужна ночному джобу (docs/05, раздел 5, правило 5) и тесту на сверку.
   * Расхождение логируется уровнем error: это не «предупреждение», а инцидент
   * целостности денег, по которому положен алерт critical.
   */
  async reconcile(membershipId: string, scope: TenantScope): Promise<BalanceReconciliation> {
    const report = await reconcileMembershipBalance(this.prisma, {
      membershipId,
      tenantId: scope.tenantId,
    })

    if (!report.consistent) {
      this.logger.error(
        `Расхождение кэша баланса и журнала: участие ${report.membershipId}, ` +
          `кэш ${report.cachedBalance}, журнал ${report.ledgerSum}, дельта ${report.drift}`,
      )
    }

    return report
  }

  /**
   * Общая обвязка всех трёх операций: идемпотентность снаружи и внутри транзакции.
   *
   * Порядок здесь важен и не случаен:
   *   1. внутри транзакции ищем запись по ключу — обычный повтор стоит один SELECT;
   *   2. если не нашли, пишем;
   *   3. если параллельный запрос успел первым, вставка падает с P2002 по UNIQUE,
   *      и мы возвращаем ЕГО запись.
   *
   * Шаг 3 нельзя сделать внутри транзакции: после нарушения ограничения транзакция
   * уже в состоянии aborted, и любой следующий запрос в ней тоже упадёт. Поэтому
   * перечитываем новым запросом, снаружи.
   */
  private async commit(params: CommitParams): Promise<LedgerOperationResult> {
    try {
      const { row, replayed } = await this.runSerializable(params.operation, async (tx) => {
        const existing = await tx.ledgerEntry.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        })

        if (existing !== null) {
          this.assertReplayMatches(existing, params)
          return { row: existing, replayed: true }
        }

        return { row: await params.write(tx), replayed: false }
      })

      if (replayed) {
        this.logReplay(params.operation, row.id)
      } else {
        this.logger.debug(
          `${params.operation}: записана операция ${row.id}, ` +
            `участие ${row.membershipId}, ${row.amount} баллов, баланс ${row.balanceAfter}`,
        )
      }

      return buildResult(row, replayed)
    } catch (error) {
      const recovered = await this.recoverFromUniqueViolation(error, params)

      if (recovered !== undefined) {
        return recovered
      }

      throw error
    }
  }

  /**
   * Гонка по ключу идемпотентности: параллельный запрос вставил запись первым.
   *
   * Возвращает результат ПЕРВОЙ операции, а не ошибку, — это и есть смысл ключа.
   * `undefined` означает «не наш случай, разбирайтесь дальше»: P2002 бывает и по
   * другому индексу (например, `reversalOfId` при двойной отмене).
   */
  private async recoverFromUniqueViolation(
    error: unknown,
    params: CommitParams,
  ): Promise<LedgerOperationResult | undefined> {
    if (!isUniqueViolation(error)) {
      return undefined
    }

    // Разбираем по факту в базе, а не по `meta.target`: имя нарушенного ограничения
    // приезжает от драйвера в разной форме и на него нельзя опираться.
    const existing = await this.prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    })

    if (existing === null) {
      return undefined
    }

    this.assertReplayMatches(existing, params)
    this.logReplay(params.operation, existing.id)

    return buildResult(existing, true)
  }

  /**
   * Ключ уже занят — проверяем, что занят ТОЙ ЖЕ операцией.
   *
   * Иначе повтор вернул бы чужой результат: в лучшем случае операцию соседнего чека,
   * в худшем — операцию соседнего тенанта.
   */
  private assertReplayMatches(existing: LedgerEntry, params: CommitParams): void {
    const { expectation } = params

    const matches =
      existing.tenantId === params.tenantId &&
      existing.type === expectation.type &&
      (expectation.membershipId === undefined ||
        existing.membershipId === expectation.membershipId) &&
      (expectation.amount === undefined || existing.amount === expectation.amount) &&
      (expectation.reversalOfId === undefined || existing.reversalOfId === expectation.reversalOfId)

    if (!matches) {
      // В details уходит только то, что прислал вызывающий: содержимое найденной
      // записи может принадлежать другому тенанту и наружу не отдаётся.
      throw new IdempotencyKeyReusedError(params.operation, {
        expectedType: expectation.type,
        expectedMembershipId: expectation.membershipId ?? null,
        expectedAmount: expectation.amount ?? null,
      })
    }
  }

  /**
   * Транзакция уровня Serializable с ограниченным ретраем.
   *
   * `Serializable` обязателен: без него два параллельных начисления на один membership
   * читают один и тот же `pointsBalance` и второе затирает первое (docs/01, раздел 4.4).
   * С ним Postgres честно отдаёт 40001 — и это не ошибка приложения, а сигнал
   * «повтори транзакцию». Именно ретрай делает тест на гонку стабильно зелёным.
   *
   * Ретраится ТОЛЬКО конфликт сериализации. Доменные ошибки и нарушения UNIQUE
   * проходят наверх сразу: повторять «баллов не хватает» бессмысленно.
   */
  private async runSerializable<T>(
    operation: string,
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          timeout: TRANSACTION_TIMEOUT_MS,
          maxWait: TRANSACTION_MAX_WAIT_MS,
        })
      } catch (error) {
        if (!isRetryableTransactionError(error)) {
          throw error
        }

        lastError = error

        if (attempt < MAX_ATTEMPTS) {
          const delay = backoffDelayMs(attempt)
          this.logger.warn(
            `${operation}: конфликт сериализации, попытка ${attempt} из ${MAX_ATTEMPTS}, ` +
              `повтор через ${delay} мс`,
          )
          await sleep(delay)
        }
      }
    }

    throw new LedgerWriteConflictError(operation, MAX_ATTEMPTS, { cause: lastError })
  }

  /** Логируем id записи, но никогда — сам ключ: в нём бывает nonce подписанного QR. */
  private logReplay(operation: string, entryId: string): void {
    this.logger.log(
      `${operation}: повтор по ключу идемпотентности — возвращена операция ${entryId}`,
    )
  }
}
