/**
 * Минимальный словарный i18n гостевого приложения.
 *
 * Форма ровно та же, что у бэк-офиса (`apps/admin/src/shared/i18n`): плоские ключи
 * по смыслу (`card.empty.title`), тип ключей выведен из ru.json — забытый перевод
 * в en.json ловит компилятор, а не гость на кассе.
 *
 * Библиотеку сознательно не тянем. Плюрализация через ICU появится вместе с первым
 * числом в интерфейсе (docs/04_Дизайн-система.md, раздел 7). Пока чисел нет — нет
 * и зависимости.
 */
import en from './locales/en.json'
import ru from './locales/ru.json'

export const LOCALES = ['ru', 'en'] as const

export type Locale = (typeof LOCALES)[number]

/** Ключи выводятся из русского словаря: он — источник правды. */
export type TranslationKey = keyof typeof ru

/** Турпоток на Пхукете русскоязычный — русский по умолчанию, как и в бэк-офисе. */
export const DEFAULT_LOCALE: Locale = 'ru'

export const LOCALE_STORAGE_KEY = 'positive.guest.locale'

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = { ru, en }

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

/**
 * Язык из localStorage; если там пусто или мусор — русский.
 *
 * `navigator.language` намеренно не читаем: тег браузера у туриста часто чужой
 * (телефон куплен в другой стране), а выбранный язык должен переживать перезагрузку.
 */
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
