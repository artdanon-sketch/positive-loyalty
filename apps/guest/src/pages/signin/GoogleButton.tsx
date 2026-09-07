import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { env } from '../../shared/config/env'
import { useT } from '../../shared/i18n/i18n-context'
import { useTheme } from '../../shared/theme/theme-context'

/**
 * Кнопка «Войти через Google».
 *
 * Кнопку рисует сам Google — своим скриптом, в своём оформлении. Так требуют
 * его правила, и так же решается задача, которую иначе пришлось бы решать
 * самим: гость видит знакомый элемент и понимает, куда нажимает.
 *
 * НЕТ КЛЮЧА — НЕТ КНОПКИ. Если `VITE_GOOGLE_CLIENT_ID` не задан при сборке,
 * компонент не рисует ничего. Показать кнопку, которая гарантированно не
 * сработает, хуже, чем не показать её вовсе: гость нажмёт, получит непонятный
 * отказ и решит, что сломана вся программа.
 *
 * Разделитель «или» живёт не здесь, а в `SocialSection`: способов входа стало
 * два, и решение «показывать ли разделитель» стало общим для обоих.
 *
 * ТОКЕН МЫ НЕ РАЗБИРАЕМ. В нём почта и имя, но доверять содержимому на стороне
 * браузера нельзя — его туда мог положить кто угодно. Мы просто передаём токен
 * серверу, а он проверяет подпись Google. Здесь токен — непрозрачная строка.
 */

/** Минимальная часть Google Identity Services, которой мы пользуемся. */
interface GoogleIdentity {
  readonly accounts: {
    readonly id: {
      initialize: (options: {
        client_id: string
        callback: (response: { credential?: string }) => void
        cancel_on_tap_outside?: boolean
      }) => void
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon'
          theme?: 'outline' | 'filled_blue' | 'filled_black'
          size?: 'small' | 'medium' | 'large'
          shape?: 'rectangular' | 'pill'
          text?: 'signin_with' | 'continue_with'
          width?: number
          locale?: string
        },
      ) => void
    }
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client'

/**
 * Загружает скрипт Google один раз на страницу.
 *
 * Повторная вставка тега привела бы к повторной инициализации и второй кнопке:
 * экран входа может смонтироваться заново — например, после неудачной попытки.
 */
const loadGoogleScript = (): Promise<GoogleIdentity> =>
  new Promise((resolve, reject) => {
    const existing = (window as unknown as { google?: GoogleIdentity }).google

    if (existing !== undefined) {
      resolve(existing)
      return
    }

    const already = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)

    const onLoad = (): void => {
      const google = (window as unknown as { google?: GoogleIdentity }).google
      if (google === undefined) {
        reject(new Error('Скрипт Google загрузился, но ничего не объявил'))
        return
      }
      resolve(google)
    }

    if (already !== null) {
      already.addEventListener('load', onLoad, { once: true })
      already.addEventListener('error', () => {
        reject(new Error('Скрипт Google не загрузился'))
      })
      return
    }

    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', () => {
      reject(new Error('Скрипт Google не загрузился'))
    })
    document.head.appendChild(script)
  })

interface Props {
  /** Что делать с полученным токеном. Проверяет его сервер, не мы. */
  readonly onToken: (idToken: string) => void
  readonly disabled: boolean
}

export function GoogleButton({ onToken, disabled }: Props): ReactElement | null {
  const t = useT()
  const { theme } = useTheme()
  const holder = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const clientId = env.VITE_GOOGLE_CLIENT_ID ?? ''

  // Колбэк держим в ref: Google вызывает его позже, а initialize мы делаем
  // один раз. Без ref в замыкании остался бы первый onToken, и после
  // перерисовки кнопка отдавала бы токен в устаревший обработчик.
  const latest = useRef(onToken)

  // Присваивание именно в эффекте, а не в теле компонента: React запрещает
  // писать в ref во время отрисовки — при повторном проходе (строгий режим,
  // приостановка) запись может выполниться дважды или не выполниться вовсе.
  useEffect(() => {
    latest.current = onToken
  }, [onToken])

  useEffect(() => {
    if (clientId === '') {
      return
    }

    let cancelled = false

    void loadGoogleScript()
      .then((google) => {
        if (cancelled || holder.current === null) {
          return
        }

        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (typeof response.credential === 'string' && response.credential !== '') {
              latest.current(response.credential)
            }
          },
          // Всплывающая подсказка «войти в один клик» на экране входа мешает:
          // она перекрывает поле телефона и появляется без спроса.
          cancel_on_tap_outside: true,
        })

        // Кнопку рисуем заново при каждой смене темы, а прежнюю убираем:
        // Google ДОБАВЛЯЕТ разметку внутрь, а не заменяет её, и без очистки
        // после переключения темы кнопок стало бы две.
        holder.current.replaceChildren()

        google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          // Белая кнопка на тёмной карточке выглядит вставкой из другого
          // приложения. Google даёт готовый тёмный вариант — берём его,
          // а не перекрашиваем чужую кнопку своими стилями: правила Google
          // это запрещают, да и сломается при любом их обновлении.
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          // Ширина — по форме, чтобы кнопка встала вровень с «Получить код»,
          // а не была уже её. Google принимает только число и не больше 400.
          width: Math.min(400, Math.max(200, Math.round(holder.current.offsetWidth))),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [clientId, theme])

  if (clientId === '') {
    return null
  }

  if (failed) {
    // Не молчим: гость должен понимать, почему кнопки нет, и что вход по коду
    // остаётся. Молчаливое исчезновение выглядит как поломка программы.
    return (
      <p className="signin__hint" role="status">
        {t('signin.google.unavailable')}
      </p>
    )
  }

  return (
    <div className="signin__google" aria-busy={disabled}>
      <div className="signin__googleButton" ref={holder} />
    </div>
  )
}
