import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nValue } from '../../shared/i18n/i18n-context'
import { LOCALE_STORAGE_KEY, getInitialLocale, type Locale } from '../../shared/i18n/dictionaries'

interface I18nProviderProps {
  children: ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
  // Язык берётся из сохранённого выбора, а не из тега браузера: тег у туриста
  // часто чужой, а выбор должен переживать перезагрузку страницы.
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  // Атрибут lang нужен скринридеру и переносам строк — держим его в согласии
  // с состоянием, а не только в момент переключения.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // Не смогли запомнить — интерфейс всё равно переключился.
    }
  }, [])

  const value = useMemo<I18nValue>(() => ({ locale, setLocale }), [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
