/**
 * Переключение темы оформления.
 *
 * Тёмная тема — основная, светлая переопределяет токены (docs/04, раздел 2).
 * Тема живёт в атрибуте `data-theme` на `<html>`, значение — из localStorage,
 * дефолт — из `prefers-color-scheme`.
 *
 * Все функции безопасны там, где нет DOM (SSR, прогрев, юнит-тесты без jsdom):
 * отсутствие `document`, `window` или `localStorage` не бросает исключение.
 */

/** Доступные темы. Третьей не будет: «системная» — это дефолт, а не режим. */
export type Theme = 'dark' | 'light'

/** Тёмная тема основная — она же дефолт, если система молчит. */
export const DEFAULT_THEME: Theme = 'dark'

/**
 * Ключ в localStorage. Пространство имён общее для всех фронтов POSitive:
 * гость и бэк-офис читают одну и ту же тему.
 *
 * Значение продублировано в `apps/guest/index.html` — инлайн-скрипт ставит тему
 * до загрузки бандла и импортировать эту константу не может. Меняешь ключ здесь —
 * правь и там.
 */
export const THEME_STORAGE_KEY = 'positive:theme'

/** Атрибут, который читает CSS. Ставится на documentElement, то есть на `<html>`. */
export const THEME_ATTRIBUTE = 'data-theme'

const LIGHT_MEDIA_QUERY = '(prefers-color-scheme: light)'

/** Сужает произвольное значение до Theme — нужно для данных из localStorage и DOM. */
export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

function readStoredTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null

  try {
    const stored: unknown = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // Приватный режим Safari и заблокированные сторонние хранилища бросают SecurityError.
    return null
  }
}

function writeStoredTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Не смогли запомнить — тема всё равно применена к текущей странице.
  }
}

/** Тема, которую предлагает операционная система. */
export function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME
  }

  try {
    return window.matchMedia(LIGHT_MEDIA_QUERY).matches ? 'light' : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * Тема для первой отрисовки: выбор пользователя, иначе предпочтение системы.
 * Вызывать до монтирования приложения, чтобы не мигать чужой темой.
 */
export function getInitialTheme(): Theme {
  return readStoredTheme() ?? getSystemTheme()
}

/** Тема, которая сейчас применена к документу. */
export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') return getInitialTheme()

  const applied: unknown = document.documentElement.getAttribute(THEME_ATTRIBUTE)
  return isTheme(applied) ? applied : getInitialTheme()
}

/**
 * Применяет тему к документу и по умолчанию запоминает выбор.
 *
 * На старте приложения запоминать не надо — иначе предпочтение системы
 * запишется в localStorage как осознанный выбор и перестанет следовать
 * за настройками устройства:
 *
 *   applyTheme(getInitialTheme(), false)   // старт
 *   applyTheme('light')                    // пользователь выбрал сам
 *
 * Возвращает применённую тему.
 */
export function applyTheme(theme: Theme, persist = true): Theme {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
  }

  if (persist) writeStoredTheme(theme)
  return theme
}

/** Переключает тему на противоположную. Возвращает ту, которая стала активной. */
export function toggleTheme(): Theme {
  return applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark')
}
