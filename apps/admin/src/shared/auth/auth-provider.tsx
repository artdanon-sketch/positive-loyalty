import type { AuthTokens } from '@positive/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { ApiError, requestJson } from '../api/http'
import { getApiUrl } from '../config/api-url'
import { AuthContext } from './auth-context'
import type { AuthContextValue, AuthStatus, Session } from './auth-context'

/**
 * Провайдер сессии бэк-офиса.
 *
 * Access-токен живёт ТОЛЬКО в памяти: в localStorage его не кладём, чтобы
 * XSS-инъекция не унесла рабочий токен одним чтением ключа. Refresh хранится
 * в localStorage — осознанный размен: без него каждый F5 разлогинивает,
 * а httpOnly-куки потребовали бы переделки API на куки-сессии. Красть refresh
 * менее полезно: он одноразовый, а ротация с обнаружением повтора гасит всю
 * цепочку при первом же использовании украденного звена (docs/05, раздел 2).
 */

const REFRESH_STORAGE_KEY = 'positive.admin.refresh'

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
    // Приватный режим: сессия проживёт до перезагрузки страницы, и это честно.
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<AuthStatus>('restoring')
  const [session, setSession] = useState<Session | null>(null)

  // Зеркало состояния для authFetch: его дёргают queryFn, и замыкание на
  // устаревший токен — источник «работает, пока не мигнёт». Пишется ТОЛЬКО
  // в обработчиках ниже, не в рендере: доступ к ref во время рендера запрещён.
  const sessionRef = useRef<Session | null>(null)

  /**
   * ОДИН рефреш на всех. Два параллельных 401 без этого устроили бы гонку:
   * первый запрос ротирует токен, второй приходит со СТАРЫМ — сервер видит
   * повторное использование отозванного звена, расценивает как кражу и гасит
   * всю цепочку. Мы бы разлогинивали пользователя собственной параллельностью.
   */
  const refreshInFlight = useRef<Promise<Session | null> | null>(null)

  const applyTokens = useCallback((tokens: AuthTokens): Session => {
    const next: Session = { accessToken: tokens.accessToken, subject: tokens.subject }
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

  const refreshSession = useCallback((): Promise<Session | null> => {
    const running = refreshInFlight.current
    if (running !== null) {
      return running
    }

    const stored = readStoredRefresh()
    if (stored === null) {
      // Ронять состояние здесь нельзя: путь синхронный, а вызов приходит и из
      // эффекта монтирования — синхронный setState в эффекте каскадит рендеры.
      // Сессии и так нет: sessionRef чист, хранилище пусто.
      return Promise.resolve(null)
    }

    const attempt = (async (): Promise<Session | null> => {
      try {
        const tokens = await requestJson<AuthTokens>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: stored }),
        })
        return applyTokens(tokens)
      } catch {
        // Просрочен, отозван или сервер недоступен — сессии больше нет.
        dropSession()
        return null
      } finally {
        refreshInFlight.current = null
      }
    })()

    refreshInFlight.current = attempt
    return attempt
  }, [applyTokens, dropSession])

  // Восстановление после перезагрузки: пока идёт — заставка, а не мигание
  // экраном входа перед человеком с живой сессией.
  useEffect(() => {
    void refreshSession().finally(() => {
      setStatus('ready')
    })
  }, [refreshSession])

  const login = useCallback(
    async (deviceId: string, pin: string): Promise<void> => {
      const tokens = await requestJson<AuthTokens>('/auth/staff/pin', {
        method: 'POST',
        body: JSON.stringify({ deviceId, pin }),
      })
      applyTokens(tokens)
    },
    [applyTokens],
  )

  const loginByEmail = useCallback(
    async (email: string, password: string): Promise<void> => {
      const tokens = await requestJson<AuthTokens>('/auth/staff/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      applyTokens(tokens)
    },
    [applyTokens],
  )

  const authFetch = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const withToken = (token: string): RequestInit => ({
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      })

      const current = sessionRef.current
      if (current === null) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Сессия не установлена')
      }

      try {
        return await requestJson<T>(path, withToken(current.accessToken))
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error
        }

        const renewed = await refreshSession()
        if (renewed === null) {
          dropSession()
          throw error
        }

        return requestJson<T>(path, withToken(renewed.accessToken))
      }
    },
    [dropSession, refreshSession],
  )

  /**
   * Поток от имени сессии. Та же логика обновления токена, что у `authFetch`,
   * но ответ отдаётся целиком: тело читает вызывающий.
   */
  const authStream = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const withToken = (token: string): RequestInit => ({
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      })

      const current = sessionRef.current

      if (current === null) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Сессия не установлена')
      }

      const open = async (token: string): Promise<Response> => {
        const response = await fetch(`${getApiUrl()}${path}`, withToken(token))

        if (!response.ok) {
          throw new ApiError(response.status, 'STREAM_FAILED', `Поток ${path} не открылся`)
        }

        return response
      }

      try {
        return await open(current.accessToken)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error
        }

        const renewed = await refreshSession()

        if (renewed === null) {
          dropSession()
          throw error
        }

        return open(renewed.accessToken)
      }
    },
    [dropSession, refreshSession],
  )

  const logout = useCallback(() => {
    // Отзыв цепочки на сервере приедет вместе с эндпоинтом logout;
    // пока честно забываем сессию на клиенте.
    dropSession()
  }, [dropSession])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, login, loginByEmail, logout, authFetch, authStream }),
    [authFetch, authStream, login, loginByEmail, logout, session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
