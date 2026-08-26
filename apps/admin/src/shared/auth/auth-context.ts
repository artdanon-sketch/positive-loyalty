import type { AuthTokens } from '@positive/contracts'
import { createContext, useContext } from 'react'

/**
 * Контекст сессии. Отдельным .ts-файлом от провайдера — по той же причине,
 * что theme-context: react-refresh корректно горячо заменяет только файлы,
 * экспортирующие одни компоненты, а хук и контекст компонентами не являются.
 */

export type AuthSubject = AuthTokens['subject']

export interface Session {
  readonly accessToken: string
  readonly subject: AuthSubject
}

export type AuthStatus = 'restoring' | 'ready'

export interface AuthContextValue {
  readonly status: AuthStatus
  readonly session: Session | null
  readonly login: (deviceId: string, pin: string) => Promise<void>
  readonly logout: () => void
  /**
   * Запрос от имени сессии: подставляет токен, на 401 один раз обновляет
   * сессию и повторяет. Второй 401 подряд означает, что сессия мертва.
   */
  readonly authFetch: <T>(path: string, init?: RequestInit) => Promise<T>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth вызван вне AuthProvider — проверьте порядок провайдеров')
  }
  return value
}
