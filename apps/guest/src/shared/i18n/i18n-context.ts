import { createContext, useCallback, useContext } from 'react'

import { dictionaries, type Locale, type TranslationKey } from './dictionaries'

export interface I18nValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
}

export const I18nContext = createContext<I18nValue | null>(null)

function useI18n(): I18nValue {
  const value = useContext(I18nContext)

  if (value === null) {
    throw new Error('Хук i18n вызван вне I18nProvider')
  }

  return value
}

/** Текущий язык интерфейса. */
export function useLocale(): Locale {
  return useI18n().locale
}

/** Смена языка интерфейса, с запоминанием выбора. */
export function useSetLocale(): (locale: Locale) => void {
  return useI18n().setLocale
}

/** Хук перевода: `const t = useT()` → `t('card.title')`. */
export function useT(): (key: TranslationKey) => string {
  const locale = useLocale()
  return useCallback((key: TranslationKey) => dictionaries[locale][key], [locale])
}
