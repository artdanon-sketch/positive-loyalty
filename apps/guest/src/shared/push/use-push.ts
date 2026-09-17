import { useCallback, useEffect, useState } from 'react'
import { PushConfig, PushSubscribed } from '@positive/contracts'

import { useSession } from '../session/session-context'
import { insideTelegram } from '../telegram/mini-app'

import { keyToBytes, pushState, subscriptionBody } from './push-support'
import type { PushState } from './push-support'

/**
 * Уведомления в карте гостя. docs/02, раздел 2.10.
 *
 * ВНУТРИ TELEGRAM НЕ ПРЕДЛАГАЕМ: там канал связи уже есть — переписка с ботом.
 * Второе разрешение на то же самое только раздражает.
 *
 * СПРАШИВАЕМ ТОЛЬКО ПО НАЖАТИЮ. Разрешение, запрошенное при открытии карты,
 * гость отклоняет не глядя — и вернуть его мы уже не сможем: браузер второй раз
 * не спрашивает. Одна попытка, и та в ответ на осознанное действие.
 */

const supported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  !insideTelegram()

export interface PushControls {
  readonly state: PushState
  /** Спросить разрешение и подписаться. */
  readonly enable: () => void
  /** Отписаться на этом устройстве. */
  readonly disable: () => void
  readonly busy: boolean
  readonly error: string | null
}

export function usePush(): PushControls {
  const { authGet, authPost } = useSession()
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported() ? Notification.permission : 'default',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported()) {
      return
    }

    let cancelled = false

    const load = async (): Promise<void> => {
      try {
        const config = await authGet('/guest/push/config', PushConfig)
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()

        if (!cancelled) {
          setPublicKey(config.enabled ? config.publicKey : null)
          setSubscribed(existing !== null)
        }
      } catch {
        // Сервер не ответил — блок просто не показываем. Уведомления не та вещь,
        // ради которой стоит пугать гостя ошибкой на карте.
        if (!cancelled) {
          setPublicKey(null)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [authGet])

  const enable = useCallback((): void => {
    if (publicKey === null || busy) {
      return
    }

    setBusy(true)
    setError(null)

    const run = async (): Promise<void> => {
      try {
        const granted = await Notification.requestPermission()
        setPermission(granted)

        if (granted !== 'granted') {
          return
        }

        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.subscribe({
          // Без этого браузер откажет: тихие уведомления запрещены.
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(publicKey),
        })

        const body = subscriptionBody(subscription)

        if (body === null) {
          setError('Устройство не отдало ключи для уведомлений')
          return
        }

        await authPost('/guest/push/subscribe', body, PushSubscribed)
        setSubscribed(true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не получилось включить уведомления')
      } finally {
        setBusy(false)
      }
    }

    void run()
  }, [authPost, busy, publicKey])

  const disable = useCallback((): void => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    const run = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        if (subscription !== null) {
          // Сначала сервер, потом браузер: отписка, о которой сервер не узнал,
          // оставила бы гостя получать уведомления после «выключить».
          await authPost(
            '/guest/push/unsubscribe',
            { endpoint: subscription.endpoint },
            PushSubscribed,
          )
          await subscription.unsubscribe()
        }

        setSubscribed(false)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не получилось выключить уведомления')
      } finally {
        setBusy(false)
      }
    }

    void run()
  }, [authPost, busy])

  return {
    state: pushState({
      supported: supported(),
      serverReady: publicKey !== null,
      permission,
      subscribed,
    }),
    enable,
    disable,
    busy,
    error,
  }
}
