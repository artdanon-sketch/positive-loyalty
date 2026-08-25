import { createContext, useContext } from 'react'

import type { Theme } from '@positive/ui'

export interface ThemeValue {
  theme: Theme
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeValue | null>(null)

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)

  if (value === null) {
    throw new Error('useTheme вызван вне ThemeProvider')
  }

  return value
}
