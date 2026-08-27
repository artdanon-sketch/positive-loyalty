import { useEffect, useRef, useState } from 'react'
import { LiveFeedEvent } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Живая лента начислений. `GET /v1/admin/stream` (docs/03, раздел 2).
 *
 * ЧИТАЕТСЯ ЧЕРЕЗ `fetch`, А НЕ `EventSource`, и это не вкусовщина.
 * `EventSource` не умеет заголовки — единственный способ передать ему токен
 * это положить токен в адрес. Адреса попадают в логи прокси, в историю
 * браузера и в заголовок `Referer`; токен доступа там не место. `fetch`
 * с `ReadableStream` даёт и заголовок, и полный контроль над переподключением.
 *
 * Цена решения: разбор формата SSE приходится писать руками. Он несложный —
 * события разделены пустой строкой, поля идут как `field: value`, — и весь
 * разбор занимает десяток строк ниже.
 */

/** Сколько событий держим на экране. Лента — про «прямо сейчас», а не про историю. */
const MAX_EVENTS = 12

/** С чего начинаем паузу перед переподключением и до чего доходим. */
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export interface LiveFeedState {
  readonly events: readonly LiveFeedEvent[]
  readonly isConnected: boolean
}

export function useLiveFeed(enabled: boolean): LiveFeedState {
  const { authStream } = useAuth()
  const [events, setEvents] = useState<readonly LiveFeedEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)

  // `authStream` пересоздаётся при обновлении сессии. Попади он в зависимости
  // эффекта, поток рвался бы и переподключался на каждой ротации токена.
  const streamRef = useRef(authStream)

  useEffect(() => {
    streamRef.current = authStream
  }, [authStream])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
    let stopped = false
    let attempt = 0
    let timer: number | null = null

    const connect = async (): Promise<void> => {
      // Токен читаем через тот же путь, что и обычные запросы: он умеет
      // обновлять протухший refresh, и лента не должна знать про это сама.
      const response = await streamRef.current('/admin/stream', {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })

      const body = response.body

      if (body === null) {
        throw new Error('Поток не открылся')
      }

      setIsConnected(true)
      attempt = 0

      const reader = body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''

      for (;;) {
        const { value, done } = await reader.read()

        if (done || stopped) {
          break
        }

        buffer += value

        // События разделены пустой строкой. Хвост буфера может быть половиной
        // события — он остаётся ждать следующего куска.
        let split = buffer.indexOf('\n\n')

        while (split !== -1) {
          const chunk = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          split = buffer.indexOf('\n\n')

          const parsed = parseEvent(chunk)

          if (parsed !== null) {
            setEvents((current) => [parsed, ...current].slice(0, MAX_EVENTS))
          }
        }
      }
    }

    const run = (): void => {
      connect().catch(() => {
        if (stopped) {
          return
        }

        setIsConnected(false)

        // Экспонента с потолком: рвущаяся мобильная сеть на острове — норма,
        // и долбиться в неё раз в секунду весь вечер незачем.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
        attempt += 1
        timer = window.setTimeout(run, delay)
      })
    }

    run()

    return () => {
      stopped = true
      controller.abort()

      if (timer !== null) {
        window.clearTimeout(timer)
      }

      setIsConnected(false)
    }
  }, [enabled])

  return { events, isConnected }
}

/**
 * Разбирает одно событие SSE.
 *
 * Возвращает `null` на всём, что не является начислением: сердцебиение,
 * комментарии, будущие виды событий, которых этот экран ещё не знает.
 * Молча пропустить незнакомое здесь правильнее, чем упасть: лента обязана
 * пережить добавление нового типа события на сервере.
 */
function parseEvent(chunk: string): LiveFeedEvent | null {
  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')

  if (data === '') {
    return null
  }

  try {
    // Разбираем контрактной схемой, а не приводим типом: сервер и приложение
    // собираются из одних схем, и расхождение обязано падать здесь.
    const result = LiveFeedEvent.safeParse(JSON.parse(data))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
