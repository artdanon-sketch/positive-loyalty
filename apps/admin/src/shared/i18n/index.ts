/**
 * Минимальный словарный i18n бэк-офиса.
 *
 * Библиотеку сознательно не тянем: словарь плоский, ключи по смыслу
 * (`overview.empty.title`), тип ключей выводится из ru.json — забытый перевод
 * в en.json ловит компилятор, а не тестировщик.
 *
 * Плюрализация — на `Intl.PluralRules`, который есть в каждом браузере
 * (docs/04, раздел 7: «в русском три формы, в тайском одна»). Библиотеку ICU
 * не тянем: она весит больше пятидесяти килобайт, а нужна здесь ровно одна
 * её возможность — выбрать форму слова по числу. Правила языков живут
 * в самом движке и обновляются вместе с ним.
 */
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import en from './locales/en.json'
import ru from './locales/ru.json'

export const LOCALES = ['ru', 'en'] as const

export type Locale = (typeof LOCALES)[number]

/** Ключи выводятся из русского словаря: он — источник правды. */
export type TranslationKey = keyof typeof ru

export const DEFAULT_LOCALE: Locale = 'ru'

export const LOCALE_STORAGE_KEY = 'positive.admin.locale'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { ru, en }

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

/** Язык из localStorage; если там пусто или мусор — русский. */
export function getInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    // Приватный режим Safari запрещает localStorage — это не повод падать.
    return DEFAULT_LOCALE
  }
}

/** Перевод вне React-дерева: тесты, заголовки документа, ошибки в сервисах. */
export function t(key: TranslationKey, locale: Locale = DEFAULT_LOCALE): string {
  return dictionaries[locale][key]
}

interface LanguageContextValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext)
  if (value === null) {
    throw new Error('useLanguage вызван вне LanguageProvider')
  }
  return value
}

/** Текущий язык интерфейса. */
export function useLocale(): Locale {
  return useLanguage().locale
}

/** Смена языка интерфейса, с запоминанием выбора. */
export function useSetLocale(): (locale: Locale) => void {
  return useLanguage().setLocale
}

/**
 * Форма ключа для числа: `guests` → `guests.one` | `.few` | `.many` | `.other`.
 *
 * Категории берутся у `Intl.PluralRules`, поэтому русские три формы и тайская
 * одна получаются сами. Если нужной формы в словаре нет, откатываемся на
 * `.other`: недостающий перевод обязан показать текст, а не пустоту.
 */
export function pluralKey(base: string, count: number, locale: Locale): TranslationKey {
  const category = new Intl.PluralRules(locale).select(count)
  const exact = `${base}.${category}` as TranslationKey
  const fallback = `${base}.other` as TranslationKey

  return exact in dictionaries[locale] ? exact : fallback
}

/** Хук перевода с выбором формы по числу: `tp('advice.sleeping', 21)`. */
export function useTPlural(): (base: string, count: number) => string {
  const locale = useLocale()
  return useCallback(
    (base: string, count: number) => dictionaries[locale][pluralKey(base, count, locale)],
    [locale],
  )
}

/** Хук перевода: `const t = useT()` → `t('overview.title')`. */
export function useT(): (key: TranslationKey) => string {
  const locale = useLocale()
  return useCallback((key: TranslationKey) => dictionaries[locale][key], [locale])
}

export function LanguageProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.documentElement.setAttribute('lang', next)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // Не смогли запомнить — интерфейс всё равно переключился.
    }
  }, [])

  const value = useMemo<LanguageContextValue>(() => ({ locale, setLocale }), [locale, setLocale])

  return createElement(LanguageContext.Provider, { value }, children)
}
