import { POS_QUEUE_REPORT_MAX } from '@positive/contracts'
import type { PosQueueReport, PosQueueTarget } from '@positive/contracts'

import type { QueuedSale } from './offline-queue'

/**
 * Снимок очереди для владельца. docs/10, раздел 5.7.
 *
 * Планшет сообщает серверу, что у него лежит, — чтобы владелец узнал о госте
 * без баллов не от гостя. Сервер по снимку ничего не проводит.
 *
 * МЕТКА ПЛАНШЕТА — СЛУЧАЙНАЯ. В токене нет устройства, а просить кассира
 * представиться значило бы получить «планшет у бара» на трёх планшетах.
 * Метка создаётся один раз и живёт в хранилище браузера: владельцу хватает
 * «кассир Лек, планшет …a1b2», чтобы понять, кому звонить.
 */

const TERMINAL_KEY = 'positive.pos.terminal'
const REPORTED_KEY = 'positive.pos.queue.reported'
const TERMINAL_PATTERN = /^[A-Za-z0-9-]{8,64}$/

const randomId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

/** Метка на время жизни страницы, если хранилище браузера закрыто. */
let ephemeral: string | null = null

export function terminalId(): string {
  try {
    const stored = window.localStorage.getItem(TERMINAL_KEY)

    if (stored !== null && TERMINAL_PATTERN.test(stored)) {
      return stored
    }

    const created = randomId()
    window.localStorage.setItem(TERMINAL_KEY, created)
    return created
  } catch {
    ephemeral ??= randomId()
    return ephemeral
  }
}

/**
 * Присылал ли планшет в прошлый раз непустой снимок.
 *
 * Нужно после перезагрузки: очередь уже пуста, а у владельца ещё висят чеки
 * из прошлого снимка. Такой планшет обязан один раз прислать пустой снимок —
 * иначе владелец неделю смотрел бы на давно ушедшие чеки.
 */
export function wasReportedNonEmpty(): boolean {
  try {
    return window.localStorage.getItem(REPORTED_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberReported(nonEmpty: boolean): void {
  try {
    window.localStorage.setItem(REPORTED_KEY, nonEmpty ? '1' : '0')
  } catch {
    // Хранилище закрыто: в худшем случае пришлём лишний пустой снимок.
  }
}

/** Изменилась ли очередь: чеки и число попыток. */
export const snapshotSignature = (sales: readonly QueuedSale[]): string =>
  sales.map((sale) => `${sale.receiptId}:${String(sale.attempts)}`).join('|')

export const toReport = (terminal: string, sales: readonly QueuedSale[]): PosQueueReport => ({
  terminalId: terminal,
  items: sales.slice(0, POS_QUEUE_REPORT_MAX).map((sale) => {
    const target: PosQueueTarget =
      sale.target.kind === 'MEMBERSHIP'
        ? { kind: 'MEMBERSHIP', membershipId: sale.target.membershipId }
        : { kind: 'PHONE', phone: sale.target.phone }

    return {
      receiptId: sale.receiptId,
      amount: sale.amount,
      ...(sale.receiptNumber === undefined ? {} : { receiptNumber: sale.receiptNumber }),
      target,
      attempts: sale.attempts,
      ...(sale.lastError === undefined ? {} : { lastError: sale.lastError.slice(0, 300) }),
      queuedAt: new Date(sale.queuedAt).toISOString(),
    }
  }),
})
