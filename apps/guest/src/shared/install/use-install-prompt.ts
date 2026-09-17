import { useCallback, useEffect, useState } from 'react'

import { insideTelegram } from '../telegram/mini-app'

/**
 * Предложение поставить карту на телефон. docs/03, раздел 10.
 *
 * ДВА РАЗНЫХ МИРА. Android спрашивает разрешение сам: браузер присылает событие,
 * мы его придерживаем и показываем свою кнопку в подходящий момент. iPhone такого
 * события не присылает вовсе — там установка делается руками через «Поделиться →
 * На экран «Домой», и единственное, что мы можем, — объяснить это словами.
 *
 * ВНУТРИ TELEGRAM НЕ ПРЕДЛАГАЕМ: карта уже открыта в мессенджере, у гостя уже
 * есть и ярлык (чат с ботом), и канал связи. Второе предложение здесь — шум.
 *
 * УСТАНОВЛЕННОЙ КАРТЕ ПРЕДЛАГАТЬ НЕЧЕГО: если приложение открыто с домашнего
 * экрана, система сама говорит об этом через `display-mode: standalone`.
 */

/** Событие Android-браузера: «страницу можно установить». В типах его нет. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState =
  /** Предлагать нечего: уже установлено, Telegram или неподходящий браузер. */
  | { readonly kind: 'hidden' }
  /** Android: нажатие вызывает системное окно установки. */
  | { readonly kind: 'ready'; readonly install: () => void }
  /** iPhone: окна нет, показываем словами, что нажать. */
  | { readonly kind: 'manual' }

const standalone = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  const display = window.matchMedia?.('(display-mode: standalone)').matches === true
  // Safari на iPhone о себе сообщает по-своему, `display-mode` там появился позже.
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true

  return display || ios
}

const isIos = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }

  const ua = navigator.userAgent
  // iPad с iPadOS 13+ представляется Mac — отличаем по касанию.
  const iPadOs = ua.includes('Macintosh') && navigator.maxTouchPoints > 1

  return /iPhone|iPad|iPod/.test(ua) || iPadOs
}

export function useInstallPrompt(): InstallState {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const onPrompt = (raw: Event): void => {
      // Придерживаем событие: браузер показал бы своё окно сразу, а гость
      // открыл карту ради кода кассиру — установка подождёт до его паузы.
      raw.preventDefault()
      setEvent(raw as InstallEvent)
    }

    const onInstalled = (): void => {
      setDone(true)
      setEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(() => {
    if (event === null) {
      return
    }

    void event.prompt().then(
      () => {
        setEvent(null)
      },
      () => {
        setEvent(null)
      },
    )
  }, [event])

  if (done || standalone() || insideTelegram()) {
    return { kind: 'hidden' }
  }

  if (event !== null) {
    return { kind: 'ready', install }
  }

  return isIos() ? { kind: 'manual' } : { kind: 'hidden' }
}
