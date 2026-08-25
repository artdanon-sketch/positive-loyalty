import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, getInitialTheme, type Theme } from '@positive/ui'

import { ThemeContext, type ThemeValue } from '../../shared/theme/theme-context'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // Синхронизация DOM с состоянием — без записи в хранилище: предпочтение системы
  // не должно превратиться в осознанный выбор и перестать следовать за настройками
  // устройства. Запоминает только toggleTheme — там выбор действительно осознанный.
  useEffect(() => {
    applyTheme(theme, false)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(applyTheme(theme === 'dark' ? 'light' : 'dark'))
  }, [theme])

  const value = useMemo<ThemeValue>(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
