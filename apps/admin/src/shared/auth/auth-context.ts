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
  /** Вход владельца и менеджера по почте и паролю. */
  readonly loginByEmail: (email: string, password: string) => Promise<void>
  readonly logout: () => void
  /**
   * Запрос от имени сессии: подставляет токен, на 401 один раз обновляет
   * сессию и повторяет. Второй 401 подряд означает, что сессия мертва.
   */
  readonly authFetch: <T>(path: string, init?: RequestInit) => Promise<T>
  /**
   * То же, но возвращает СЫРОЙ ответ, не разбирая тело.
   *
   * Нужен живой ленте: она читает `text/event-stream` кусками, а не одним
   * JSON. Отдельным методом, а не флагом в `authFetch`: тот обещает разбор
   * тела своей сигнатурой, и «иногда не разбирает» — худший вид сюрприза.
   *
   * Существует ещё и потому, что `EventSource` не умеет заголовки, а класть
   * токен доступа в адрес нельзя: адреса попадают в логи прокси, в историю
   * браузера и в `Referer`.
   */
  readonly authStream: (path: string, init?: RequestInit) => Promise<Response>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth вызван вне AuthProvider — проверьте порядок провайдеров')
  }
  return value
}
