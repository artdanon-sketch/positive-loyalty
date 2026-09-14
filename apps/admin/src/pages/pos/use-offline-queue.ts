import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PosGuest, PreviewResult } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import {
  dequeue,
  enqueue,
  flushQueue,
  isStuck,
  readQueue,
  resetForRetry,
  type QueuedSale,
  type QueuedTarget,
  type SaleSender,
} from './offline-queue'
import {
  rememberReported,
  snapshotSignature,
  terminalId,
  toReport,
  wasReportedNonEmpty,
} from './queue-report'

/**
 * Очередь чеков, привязанная к сессии и к состоянию сети.
 *
 * Отправка запускается по трём поводам, и все три нужны:
 *
 *   • браузер сказал `online` — самый быстрый и самый ненадёжный сигнал:
 *     он означает «есть подключение», а не «есть интернет». Wi-Fi отеля
 *     отдаёт `online` ещё до страницы авторизации;
 *   • по таймеру — тот случай, когда `online` соврал или не пришёл вовсе;
 *   • при постановке в очередь — вдруг сеть уже вернулась, и чек уйдёт сразу.
 */

/** Как часто пробуем сами. Полминуты: чаще — зря греем планшет, реже — гость ушёл. */
const FLUSH_INTERVAL_MS = 30_000

/**
 * Как часто планшет подтверждает владельцу, что застрявший чек всё ещё лежит.
 * Изменения уходят сразу; тот же снимок — не чаще раза в пять минут.
 */
const REPORT_EVERY_MS = 5 * 60 * 1000

export interface OfflineQueueState {
  /** Чеки этого заведения, ждущие отправки. */
  readonly sales: readonly QueuedSale[]
  /** Ждут отправки, включая застрявшие. */
  readonly pending: number
  /** Застрявшие: попытки исчерпаны либо сервер отказал. Их разбирает человек. */
  readonly stuck: readonly QueuedSale[]
  readonly isOnline: boolean
  /**
   * Кладёт чек в очередь и сразу пробует отправить.
   *
   * Возвращает `false`, если поставить не удалось. Молчаливая неудача здесь
   * недопустима: экран сказал бы «чек принят», а чека бы не было — и кассир
   * узнал бы об этом от гостя через неделю.
   */
  readonly queueSale: (input: {
    receiptId: string
    target: QueuedTarget
    amount: number
    receiptNumber?: string
  }) => boolean
  readonly flush: () => void
  /** Вернуть застрявший чек в работу, при желании вписав номер чека. */
  readonly retry: (receiptId: string, receiptNumber?: string) => void
  /** Убрать чек из очереди насовсем: провели заново вручную или чек ошибочный. */
  readonly discard: (receiptId: string) => void
}

export function useOfflineQueue(): OfflineQueueState {
  const { authFetch, session } = useAuth()
  const queryClient = useQueryClient()
  const tenantId = session?.subject.tenantId ?? null

  const [queue, setQueue] = useState<readonly QueuedSale[]>(() => readQueue())
  const [isOnline, setIsOnline] = useState(true)

  // `navigator.onLine` читается в эффекте, а не в теле: это внешнее изменяемое
  // состояние, и его чтение во время рендера даёт разный ответ на разных
  // проходах. На первом кадре считаем, что связь есть, — так и бывает чаще.
  useEffect(() => {
    const sync = (): void => {
      setIsOnline(window.navigator.onLine)
    }

    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)

    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  const flush = useCallback(() => {
    // Пустая очередь — ничего не делаем СОВСЕМ, включая обновление состояния.
    // Отправка запускается при каждом монтировании экрана и раз в полминуты,
    // а обычная смена проходит без единого обрыва: лишний проход рендера
    // на каждом таком холостом заходе не нужен никому.
    if (tenantId === null || readQueue().every((sale) => sale.tenantId !== tenantId)) {
      return
    }

    const sender: SaleSender = {
      findGuest: (target) =>
        target.kind === 'MEMBERSHIP'
          ? Promise.resolve({ membershipId: target.membershipId })
          : authFetch<PosGuest>(`/pos/guest?phone=${encodeURIComponent(target.phone)}`),
      preview: (input) =>
        authFetch<PreviewResult>('/pos/transactions/preview', {
          method: 'POST',
          body: JSON.stringify(input),
          headers: { 'Content-Type': 'application/json' },
        }),
      commit: (input) =>
        authFetch('/pos/transactions/commit', {
          method: 'POST',
          body: JSON.stringify(input),
          headers: { 'Content-Type': 'application/json' },
        }),
    }

    void flushQueue(sender, tenantId, Date.now()).then((result) => {
      setQueue(readQueue())

      if (result.sent > 0) {
        // Журнал и дашборд менеджера устарели: чеки доехали.
        void queryClient.invalidateQueries({ queryKey: ['admin'] })
      }
    })
  }, [authFetch, queryClient, tenantId])

  useEffect(() => {
    flush()

    const onOnline = (): void => {
      flush()
    }

    window.addEventListener('online', onOnline)
    const timer = window.setInterval(flush, FLUSH_INTERVAL_MS)

    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [flush])

  // Снимок очереди — владельцу (docs/10, раздел 5.7): чек, который не доходит,
  // должен увидеть не только кассир на этом планшете. Не дошёл отчёт — не беда:
  // пришлём при следующем изменении очереди.
  const lastReport = useRef<{ signature: string; at: number } | null>(null)

  useEffect(() => {
    if (tenantId === null) {
      return
    }

    const mine = queue.filter((sale) => sale.tenantId === tenantId)
    const signature = snapshotSignature(mine)
    const now = Date.now()
    const previous = lastReport.current

    // Ничего не лежит и владельцу ничего не показывали — сообщать нечего.
    if (mine.length === 0 && !wasReportedNonEmpty()) {
      return
    }

    // Лежит то же, что в прошлый раз, и прошло меньше пяти минут — тоже.
    if (
      previous !== null &&
      previous.signature === signature &&
      (mine.length === 0 || now - previous.at < REPORT_EVERY_MS)
    ) {
      return
    }

    lastReport.current = { signature, at: now }

    void authFetch('/pos/queue', {
      method: 'PUT',
      body: JSON.stringify(toReport(terminalId(), mine)),
      headers: { 'Content-Type': 'application/json' },
    }).then(
      () => {
        rememberReported(mine.length > 0)
      },
      () => {
        lastReport.current = previous
      },
    )
  }, [authFetch, queue, tenantId])

  const queueSale = useCallback<OfflineQueueState['queueSale']>(
    (input) => {
      if (tenantId === null) {
        return false
      }

      setQueue(
        enqueue({
          receiptId: input.receiptId,
          tenantId,
          target: input.target,
          amount: input.amount,
          ...(input.receiptNumber === undefined ? {} : { receiptNumber: input.receiptNumber }),
          queuedAt: Date.now(),
          attempts: 0,
        }),
      )

      // Пробуем сразу: связь могла вернуться, пока кассир вводил сумму.
      flush()
      return true
    },
    [flush, tenantId],
  )

  // Застрявший чек кассир возвращает в работу — например, вписав номер чека,
  // которого потребовал сервер, — или убирает, если провёл его заново вручную.
  // Убранный пропадёт и у владельца: следующий снимок очереди его не содержит.
  const retry = useCallback<OfflineQueueState['retry']>(
    (receiptId, receiptNumber) => {
      setQueue(resetForRetry(receiptId, receiptNumber))
      flush()
    },
    [flush],
  )

  const discard = useCallback<OfflineQueueState['discard']>((receiptId) => {
    setQueue(dequeue(receiptId))
  }, [])

  const own = queue.filter((sale) => sale.tenantId === tenantId)

  return {
    sales: own,
    pending: own.length,
    stuck: own.filter(isStuck),
    isOnline,
    queueSale,
    flush,
    retry,
    discard,
  }
}
