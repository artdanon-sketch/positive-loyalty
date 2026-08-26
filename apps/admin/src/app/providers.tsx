import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { applyTheme, getInitialTheme } from '@positive/ui'
import type { Theme } from '@positive/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { AuthProvider } from '../shared/auth/auth-provider'
import { LanguageProvider } from '../shared/i18n'
import { ThemeContext } from './theme-context'
import type { ThemeContextValue } from './theme-context'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Владелец заходит на две минуты — свежесть важнее экономии запросов,
        // но дёргать сервер на каждый фокус окна незачем.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  // Синхронизация DOM с состоянием — без записи в хранилище. Запоминаем только
  // осознанный выбор (setTheme/toggleTheme): иначе предпочтение системы осядет
  // в localStorage и перестанет следовать за настройками устройства.
  useEffect(() => {
    applyTheme(theme, false)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(applyTheme(next))
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [setTheme, theme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Общие провайдеры приложения: данные, тема, язык. */
export function Providers({ children }: { children: ReactNode }): ReactElement {
  // Клиент создаётся один раз на жизнь приложения, а не на каждый рендер.
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
