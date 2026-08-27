import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PosGuest, PreviewResult } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import {
  enqueue,
  flushQueue,
  isStuck,
  readQueue,
  type QueuedSale,
  type QueuedTarget,
  type SaleSender,
} from './offline-queue'

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

  const own = queue.filter((sale) => sale.tenantId === tenantId)

  return {
    sales: own,
    pending: own.length,
    stuck: own.filter(isStuck),
    isOnline,
    queueSale,
    flush,
  }
}
