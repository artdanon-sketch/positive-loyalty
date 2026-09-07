import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n/i18n-context'
import { useSession } from '../../shared/session/session-context'

/**
 * Кнопка «Войти через Telegram».
 *
 * ПОЧЕМУ ЗДЕСЬ ДВА ШАГА, А НЕ ОДИН, КАК У GOOGLE. Подтверждение приходит
 * не из этого окна: гость уходит в Telegram, нажимает «Запустить», и об этом
 * узнаёт сервер — а не браузер. Поэтому сначала мы просим ссылку, потом гость
 * по ней уходит, и всё это время мы спрашиваем сервер: «уже?».
 *
 * ССЫЛКА — НАСТОЯЩАЯ ССЫЛКА, А НЕ `window.open`. Это принципиально:
 *
 * - В браузере всплывающее окно, открытое ПОСЛЕ ожидания ответа сервера,
 *   блокировщик считает непрошеным и глушит. Переход по ссылке, которую
 *   нажал человек, не глушит никто.
 * - В мобильном приложении обычная ссылка отдаётся системе, и её подхватывает
 *   установленный Telegram. `window.open` в том же случае уводит из приложения
 *   его собственное окно — то есть ломает то, ради чего всё делалось.
 */

/** Немного дольше срока ссылки: пусть последний ответ сервера решает исход. */
const EXTRA_WAIT_MS = 5_000

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'waiting'
      readonly url: string
      readonly requestId: string
      readonly claimSecret: string
      readonly pollMs: number
      readonly until: number
    }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' }

interface Props {
  readonly disabled: boolean
}

export function TelegramButton({ disabled }: Props): ReactElement {
  const t = useT()
  const { startTelegramLogin, pollTelegramLogin } = useSession()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // Опрос зовёт функцию позже, уже из таймера. Без ref в замыкании остался бы
  // первый вариант — тот же случай, что у кнопки Google.
  const poll = useRef(pollTelegramLogin)
  useEffect(() => {
    poll.current = pollTelegramLogin
  }, [pollTelegramLogin])

  const begin = useCallback((): void => {
    setPhase({ kind: 'starting' })

    void startTelegramLogin()
      .then((started) => {
        setPhase({
          kind: 'waiting',
          url: started.url,
          requestId: started.requestId,
          claimSecret: started.claimSecret,
          pollMs: started.pollAfter * 1_000,
          until: Date.now() + started.expiresIn * 1_000 + EXTRA_WAIT_MS,
        })
      })
      .catch(() => {
        setPhase({ kind: 'failed' })
      })
  }, [startTelegramLogin])

  useEffect(() => {
    if (phase.kind !== 'waiting') {
      return
    }

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const ask = (): void => {
      if (stopped) {
        return
      }

      if (Date.now() > phase.until) {
        setPhase({ kind: 'expired' })
        return
      }

      void poll
        .current(phase.requestId, phase.claimSecret)
        .then((state) => {
          if (stopped) {
            return
          }

          if (state === 'EXPIRED') {
            setPhase({ kind: 'expired' })
            return
          }

          // На READY экран входа исчезает сам: сессия установлена, и маршрут
          // уводит гостя на карту. Ставить здесь ещё одно состояние незачем.
          if (state === 'PENDING') {
            timer = setTimeout(ask, phase.pollMs)
          }
        })
        .catch(() => {
          // Сеть мигнула — это не отказ во входе. Пробуем снова, пока не вышел срок.
          if (!stopped) {
            timer = setTimeout(ask, phase.pollMs)
          }
        })
    }

    timer = setTimeout(ask, phase.pollMs)

    return () => {
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [phase])

  if (phase.kind === 'waiting') {
    return (
      <div className="signin__telegramWait">
        <a
          className="signin__telegram"
          href={phase.url}
          target="_blank"
          rel="noreferrer"
          // Ссылку показываем открытой: гость мог промахнуться мимо неё или
          // закрыть Telegram — второе нажатие обязано работать.
        >
          {t('signin.telegram.open')}
        </a>

        <p className="signin__hint" role="status">
          {t('signin.telegram.waiting')}
        </p>

        <button
          className="signin__back"
          type="button"
          onClick={() => {
            setPhase({ kind: 'idle' })
          }}
        >
          {t('signin.telegram.cancel')}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        className="signin__telegram"
        type="button"
        onClick={begin}
        disabled={disabled || phase.kind === 'starting'}
      >
        {t('signin.telegram.button')}
      </button>

      {phase.kind === 'expired' || phase.kind === 'failed' ? (
        <p className="signin__hint" role="alert">
          {t(phase.kind === 'expired' ? 'signin.telegram.expired' : 'signin.telegram.failed')}
        </p>
      ) : null}
    </>
  )
}
