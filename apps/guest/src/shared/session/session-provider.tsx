import {
  GuestAuthResult,
  OtpRequestResult,
  TelegramClaimResult,
  TelegramLoginStartResult,
} from '@positive/contracts'
import type { TelegramLoginState } from '@positive/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ZodType } from 'zod'

import { ApiError, apiRequest } from '../api/api-client'
import { SessionContext } from './session-context'
import type { GuestSession, SessionContextValue, SessionStatus } from './session-context'

/**
 * Провайдер гостевой сессии.
 *
 * Access-токен живёт только в памяти, refresh — в localStorage. Тот же размен,
 * что в бэк-офисе, и по тем же причинам: без хранения refresh гость терял бы
 * карту при каждом закрытии вкладки, а красть его менее полезно — он
 * одноразовый, и повтор отозванного гасит всю цепочку на сервере.
 *
 * Для гостя это критичнее, чем для сотрудника: карта открывается у кассы,
 * в спешке, часто на чужом Wi-Fi. Повторный вход по SMS в этот момент —
 * это потерянная продажа.
 */

const REFRESH_STORAGE_KEY = 'positive.guest.refresh'

const readStoredRefresh = (): string | null => {
  try {
    return window.localStorage.getItem(REFRESH_STORAGE_KEY)
  } catch {
    return null
  }
}

const writeStoredRefresh = (token: string | null): void => {
  try {
    if (token === null) {
      window.localStorage.removeItem(REFRESH_STORAGE_KEY)
    } else {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, token)
    }
  } catch {
    // Приватный режим Safari: сессия проживёт до закрытия вкладки. Это честно
    // и лучше, чем падение на старте.
  }
}

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<SessionStatus>('restoring')
  const [session, setSession] = useState<GuestSession | null>(null)

  // Зеркало состояния для authGet: его зовут из queryFn, и замыкание на
  // устаревший токен даёт «работает, пока не мигнёт». Пишется только в
  // обработчиках, никогда в рендере.
  const sessionRef = useRef<GuestSession | null>(null)

  /**
   * Один рефреш на всех. Два параллельных 401 (карта и кошелёк грузятся
   * одновременно) иначе устроят гонку ротации: второй запрос придёт со старым
   * токеном, сервер расценит это как кражу и погасит цепочку — гость окажется
   * разлогинен нашей же параллельностью.
   */
  const refreshInFlight = useRef<Promise<GuestSession | null> | null>(null)

  const applyTokens = useCallback((tokens: GuestAuthResult): GuestSession => {
    const next: GuestSession = { accessToken: tokens.accessToken, guest: tokens.guest }
    writeStoredRefresh(tokens.refreshToken)
    sessionRef.current = next
    setSession(next)
    return next
  }, [])

  const dropSession = useCallback(() => {
    writeStoredRefresh(null)
    sessionRef.current = null
    setSession(null)
  }, [])

  const refreshSession = useCallback((): Promise<GuestSession | null> => {
    const running = refreshInFlight.current
    if (running !== null) {
      return running
    }

    const stored = readStoredRefresh()
    if (stored === null) {
      // Ронять состояние синхронно нельзя: путь вызывается из эффекта
      // монтирования, а синхронный setState в эффекте каскадит рендеры.
      return Promise.resolve(null)
    }

    const attempt = (async (): Promise<GuestSession | null> => {
      try {
        const tokens = await apiRequest('/auth/otp/refresh', GuestAuthResult, {
          method: 'POST',
          body: { refreshToken: stored },
        })
        return applyTokens(tokens)
      } catch {
        dropSession()
        return null
      } finally {
        refreshInFlight.current = null
      }
    })()

    refreshInFlight.current = attempt
    return attempt
  }, [applyTokens, dropSession])

  useEffect(() => {
    void refreshSession().finally(() => {
      setStatus('ready')
    })
  }, [refreshSession])

  const requestCode = useCallback(
    async (phone: string): Promise<{ requestId: string; devCode?: string }> => {
      const result = await apiRequest('/auth/otp/request', OtpRequestResult, {
        method: 'POST',
        body: { phone },
      })

      return {
        requestId: result.requestId,
        ...(result.devCode === undefined ? {} : { devCode: result.devCode }),
      }
    },
    [],
  )

  const verifyCode = useCallback(
    async (requestId: string, code: string): Promise<void> => {
      const tokens = await apiRequest('/auth/otp/verify', GuestAuthResult, {
        method: 'POST',
        body: { requestId, code },
      })
      applyTokens(tokens)
    },
    [applyTokens],
  )

  const signInWithGoogle = useCallback(
    async (idToken: string): Promise<void> => {
      const tokens = await apiRequest('/auth/social/google', GuestAuthResult, {
        method: 'POST',
        body: { idToken },
      })
      applyTokens(tokens)
    },
    [applyTokens],
  )

  const startTelegramLogin = useCallback(
    async (): Promise<TelegramLoginStartResult> =>
      apiRequest('/auth/social/telegram/start', TelegramLoginStartResult, { method: 'POST' }),
    [],
  )

  /**
   * Один вопрос «уже?». Цикл живёт в экране, а не здесь: как часто и сколько
   * спрашивать — это поведение интерфейса, а не работа с сессией.
   */
  const pollTelegramLogin = useCallback(
    async (requestId: string, claimSecret: string): Promise<TelegramLoginState> => {
      const result = await apiRequest('/auth/social/telegram/claim', TelegramClaimResult, {
        method: 'POST',
        body: { requestId, claimSecret },
      })

      if (result.state === 'READY' && result.session !== null) {
        applyTokens(result.session)
      }

      return result.state
    },
    [applyTokens],
  )

  /** Запрос от имени гостя: токен, на 401 — одно обновление сессии и повтор. */
  const authRequest = useCallback(
    async <T,>(
      path: string,
      schema: ZodType<T>,
      options: { readonly method: 'GET' | 'POST' | 'PUT'; readonly body?: unknown },
    ): Promise<T> => {
      const current = sessionRef.current
      if (current === null) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Сессия не установлена')
      }

      try {
        return await apiRequest(path, schema, { ...options, token: current.accessToken })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error
        }

        const renewed = await refreshSession()
        if (renewed === null) {
          dropSession()
          throw error
        }

        return apiRequest(path, schema, { ...options, token: renewed.accessToken })
      }
    },
    [dropSession, refreshSession],
  )

  const authGet = useCallback(
    async <T,>(path: string, schema: ZodType<T>): Promise<T> =>
      authRequest(path, schema, { method: 'GET' }),
    [authRequest],
  )

  const authPost = useCallback(
    async <T,>(path: string, body: unknown, schema: ZodType<T>): Promise<T> =>
      authRequest(path, schema, { method: 'POST', body }),
    [authRequest],
  )

  const authPut = useCallback(
    async <T,>(path: string, body: unknown, schema: ZodType<T>): Promise<T> =>
      authRequest(path, schema, { method: 'PUT', body }),
    [authRequest],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      requestCode,
      verifyCode,
      signInWithGoogle,
      startTelegramLogin,
      pollTelegramLogin,
      signOut: dropSession,
      authGet,
      authPost,
      authPut,
    }),
    [
      authGet,
      authPost,
      authPut,
      dropSession,
      pollTelegramLogin,
      requestCode,
      session,
      signInWithGoogle,
      startTelegramLogin,
      status,
      verifyCode,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
