/**
 * Сверка кэша баланса с журналом.
 *
 * `Membership.pointsBalance` — денормализованный КЭШ. Источник истины — сумма
 * `LedgerEntry.amount` по этому участию (docs/01, раздел 4.4, правило 2). Пока обе
 * величины пишутся в одной транзакции, они обязаны совпадать всегда; расхождение
 * означает, что баланс кто-то поменял мимо LedgerService, и это инцидент, а не
 * «небольшая рассинхронизация».
 *
 * docs/05, раздел 5, правило 5: «Джоб сравнивает Membership.pointsBalance с
 * SUM(LedgerEntry.amount). Расхождение — алерт с уровнем critical и автоматическая
 * заморозка операций по этому membership до разбора».
 *
 * Функции здесь читающие и не зависят от Nest: их зовёт и LedgerService, и ночной
 * джоб, и тест на сверку. Клиент передаётся аргументом, поэтому одна и та же сверка
 * работает и снаружи транзакции, и внутри неё (`tx`) — например, чтобы посчитать
 * контрольную сумму в том же снимке данных, в котором прошла запись.
 */
import type { Prisma } from '../generated/prisma/client'
import { BalanceDriftDetectedError, MembershipNotFoundError } from './ledger.errors'

/**
 * Минимальный клиент, который нужен сверке: две модели, только чтение.
 * Структурный тип, а не `PrismaService`, — чтобы сюда без разговоров подходил и
 * транзакционный клиент из `$transaction`.
 */
export type LedgerReadClient = Pick<Prisma.TransactionClient, 'membership' | 'ledgerEntry'>

/** Сколько участий сверяет один проход джоба, если размер не задан явно. */
const DEFAULT_SCAN_SIZE = 500

/** Результат сверки одного участия. */
export interface BalanceReconciliation {
  readonly membershipId: string
  readonly tenantId: string
  /** Что записано в `Membership.pointsBalance`. */
  readonly cachedBalance: number
  /** Что получается из журнала: SUM(LedgerEntry.amount). Источник истины. */
  readonly ledgerSum: number
  /** Кэш минус журнал. Ноль — норма, всё остальное — инцидент. */
  readonly drift: number
  /** Сколько записей журнала учтено. Ноль записей при ненулевом кэше — тоже расхождение. */
  readonly entryCount: number
  /** `true`, если кэш и журнал совпали. */
  readonly consistent: boolean
  /** Момент сверки в ISO-8601 — по нему видно, не читает ли алерт вчерашний отчёт. */
  readonly checkedAt: string
}

const buildReport = (params: {
  membershipId: string
  tenantId: string
  cachedBalance: number
  ledgerSum: number
  entryCount: number
}): BalanceReconciliation => {
  const drift = params.cachedBalance - params.ledgerSum

  return {
    membershipId: params.membershipId,
    tenantId: params.tenantId,
    cachedBalance: params.cachedBalance,
    ledgerSum: params.ledgerSum,
    drift,
    entryCount: params.entryCount,
    consistent: drift === 0,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Сверяет кэш баланса одного участия с суммой его записей в журнале.
 *
 * Тенант передаётся отдельным аргументом и приходит из токена (CLAUDE.md, правило 2),
 * а не из тела запроса. Участие чужого тенанта не «пустое», а отсутствующее:
 * docs/02, раздел 0 — чужой тенант отдаёт 404, потому что 403 подтверждает существование.
 *
 * @throws MembershipNotFoundError если участия нет или оно принадлежит другому тенанту.
 */
export const reconcileMembershipBalance = async (
  db: LedgerReadClient,
  params: { membershipId: string; tenantId: string },
): Promise<BalanceReconciliation> => {
  const membership = await db.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    select: { id: true, tenantId: true, pointsBalance: true },
  })

  if (membership === null) {
    throw new MembershipNotFoundError(params.membershipId)
  }

  // Фильтр по tenantId избыточен — membership уже проверен, — но он превращает
  // запрос в попадание по индексу и остаётся верным, если однажды журнал начнут
  // читать по составному ключу.
  const totals = await db.ledgerEntry.aggregate({
    where: { membershipId: membership.id, tenantId: membership.tenantId },
    _sum: { amount: true },
    _count: true,
  })

  return buildReport({
    membershipId: membership.id,
    tenantId: membership.tenantId,
    cachedBalance: membership.pointsBalance,
    // Пустой журнал даёт NULL, а не 0: участие без операций имеет нулевой баланс.
    ledgerSum: totals._sum.amount ?? 0,
    entryCount: totals._count,
  })
}

/**
 * Проход ночного джоба: сверяет пачку участий тенанта и возвращает ВСЕ отчёты,
 * а не только расхождения, — джобу нужно знать и сколько он проверил.
 *
 * Пачка ограничена сознательно. Сверка «всего тенанта одним запросом» на мерчанте
 * с сотней тысяч участий забирает базу целиком именно в тот час, когда её никто не
 * смотрит. Курсор `after` — id последнего участия предыдущей пачки.
 */
export const reconcileTenantBalances = async (
  db: LedgerReadClient,
  params: { tenantId: string; take?: number; after?: string },
): Promise<BalanceReconciliation[]> => {
  const take = params.take ?? DEFAULT_SCAN_SIZE

  const memberships = await db.membership.findMany({
    where: { tenantId: params.tenantId },
    select: { id: true, tenantId: true, pointsBalance: true },
    orderBy: { id: 'asc' },
    take,
    ...(params.after === undefined ? {} : { cursor: { id: params.after }, skip: 1 }),
  })

  if (memberships.length === 0) {
    return []
  }

  const membershipIds = memberships.map((membership) => membership.id)

  const grouped = await db.ledgerEntry.groupBy({
    by: ['membershipId'],
    where: { tenantId: params.tenantId, membershipId: { in: membershipIds } },
    _sum: { amount: true },
    _count: true,
  })

  const totals = new Map(grouped.map((row) => [row.membershipId, row]))

  return memberships.map((membership) => {
    const row = totals.get(membership.id)

    return buildReport({
      membershipId: membership.id,
      tenantId: membership.tenantId,
      cachedBalance: membership.pointsBalance,
      ledgerSum: row?._sum.amount ?? 0,
      entryCount: row?._count ?? 0,
    })
  })
}

/**
 * Превращает расхождение в исключение.
 *
 * Отдельная функция, а не проверка внутри сверки: джобу нужен отчёт по всей пачке,
 * а вызывающему, который хочет убедиться в целостности перед выдачей награды, —
 * жёсткий отказ. Полная реализация правила из docs/05 («заморозка операций по этому
 * membership до разбора») требует поля-флага в Membership и приедет вместе с ним.
 *
 * @throws BalanceDriftDetectedError если кэш не сошёлся с журналом.
 */
export const assertBalanceConsistent = (report: BalanceReconciliation): void => {
  if (!report.consistent) {
    throw new BalanceDriftDetectedError(report.membershipId, report.cachedBalance, report.ledgerSum)
  }
}
