import { createContext, useContext } from 'react'
import type { Theme } from '@positive/ui'

export interface ThemeContextValue {
  readonly theme: Theme
  readonly setTheme: (theme: Theme) => void
  readonly toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Текущая тема и способ её сменить. Работает только внутри `Providers`. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (value === null) {
    throw new Error('useTheme вызван вне ThemeProvider')
  }
  return value
}
