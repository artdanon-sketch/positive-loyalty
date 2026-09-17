import type {
  GuestProfile,
  TelegramLoginStartResult,
  TelegramLoginState,
} from '@positive/contracts'
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
  /**
   * Вход из мини-приложения Telegram: подписанные данные приносит сам мессенджер,
   * гость ничего не нажимает. Шаг один — подтверждать нечего, подпись уже есть.
   */
  readonly signInWithTelegramMiniApp: (initData: string) => Promise<void>
  /**
   * Вход через Telegram, шаг 1: получить одноразовую ссылку на бота.
   * Шагов здесь два, потому что подтверждение приходит не из приложения,
   * а из Telegram — возможно, с другого устройства.
   */
  readonly startTelegramLogin: () => Promise<TelegramLoginStartResult>
  /** Шаг 2: спросить, подтвердил ли гость. При `READY` сессия уже установлена. */
  readonly pollTelegramLogin: (
    requestId: string,
    claimSecret: string,
  ) => Promise<TelegramLoginState>
  readonly signOut: () => void
  /** Запрос от имени гостя: подставляет токен, на 401 обновляет сессию и повторяет. */
  readonly authGet: <T>(path: string, schema: import('zod').ZodType<T>) => Promise<T>
  /** То же для записи: тело уходит JSON, ответ разбирается схемой. */
  readonly authPost: <T>(
    path: string,
    body: unknown,
    schema: import('zod').ZodType<T>,
  ) => Promise<T>
  /** Запись целиком (PUT): тело — JSON, ответ разбирается схемой. */
  readonly authPut: <T>(path: string, body: unknown, schema: import('zod').ZodType<T>) => Promise<T>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession вызван вне SessionProvider — проверьте порядок провайдеров')
  }
  return value
}
