import type { GuestProfile } from '@positive/contracts'
import { createContext, useContext } from 'react'

/**
 * Сессия гостя. Контекст и хук отдельным .ts-модулем от провайдера:
 * react-refresh горячо заменяет только файлы, экспортирующие компоненты,
 * а хук с контекстом компонентами не являются.
 */

export interface GuestSession {
  readonly accessToken: string
  readonly guest: GuestProfile
}

export type SessionStatus = 'restoring' | 'ready'

export interface SessionContextValue {
  readonly status: SessionStatus
  readonly session: GuestSession | null
  /** Шаг 1 входа: попросить код. Возвращает requestId и, вне production, сам код. */
  readonly requestCode: (phone: string) => Promise<{ requestId: string; devCode?: string }>
  /** Шаг 2: подтвердить код и получить сессию. */
  readonly verifyCode: (requestId: string, code: string) => Promise<void>
  /**
   * Вход через Google: шага два не нужно, личность уже подтверждена.
   * На вход — токен от Google, который проверяет сервер, а не мы.
   */
  readonly signInWithGoogle: (idToken: string) => Promise<void>
  readonly signOut: () => void
  /** Запрос от имени гостя: подставляет токен, на 401 обновляет сессию и повторяет. */
  readonly authGet: <T>(path: string, schema: import('zod').ZodType<T>) => Promise<T>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession вызван вне SessionProvider — проверьте порядок провайдеров')
  }
  return value
}
