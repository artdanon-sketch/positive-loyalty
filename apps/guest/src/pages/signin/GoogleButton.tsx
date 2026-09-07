import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { env } from '../../shared/config/env'
import { useT } from '../../shared/i18n/i18n-context'

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

        google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
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
  }, [clientId])

  if (clientId === '') {
    return null
  }

  /**
   * Разделитель живёт ЗДЕСЬ, а не в форме.
   *
   * Сначала он стоял снаружи, при условии «первый шаг входа», — и на боевой
   * странице получилось «или», под которым ничего нет: ключ до сборки
   * не доехал, кнопка не отрисовалась, а разделитель остался. Выглядело как
   * недогрузившийся экран.
   *
   * Условие у разделителя и у кнопки должно быть одно, иначе они разъезжаются
   * ровно в тот момент, когда что-то пошло не так.
   */
  const divider = (
    <div className="signin__divider">
      <span>{t('signin.or')}</span>
    </div>
  )

  if (failed) {
    // Не молчим: гость должен понимать, почему кнопки нет, и что вход по коду
    // остаётся. Молчаливое исчезновение выглядит как поломка программы.
    return (
      <>
        {divider}
        <p className="signin__hint" role="status">
          {t('signin.google.unavailable')}
        </p>
      </>
    )
  }

  return (
    <>
      {divider}
      <div className="signin__google" aria-busy={disabled}>
        <div className="signin__googleButton" ref={holder} />
      </div>
    </>
  )
}
