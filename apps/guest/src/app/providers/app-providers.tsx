import { BrowserRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import { I18nProvider } from './i18n-provider'
import { QueryProvider } from './query-provider'
import { ThemeProvider } from './theme-provider'

interface AppProvidersProps {
  children: ReactNode
}

/** Порядок важен: тема и язык нужны всем, роутер — самый внутренний слой. */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryProvider>
          <BrowserRouter>{children}</BrowserRouter>
        </QueryProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
