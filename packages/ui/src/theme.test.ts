import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  getCurrentTheme,
  getInitialTheme,
  getSystemTheme,
  isTheme,
  toggleTheme,
  type Theme,
} from './theme.js'

/**
 * jsdom вообще не реализует matchMedia — `window.matchMedia` там `undefined`.
 * Поэтому подменяем глобал целиком (`vi.stubGlobal`), а не шпионим за методом:
 * `vi.spyOn` на несуществующей функции падает ещё до проверки.
 *
 * Полный MediaQueryList писать незачем: код читает только `matches`.
 * `as unknown as` вместо `as any` — типизация не отключается, сужение видно.
 */
function stubMatchMedia(implementation: (query: string) => MediaQueryList): void {
  vi.stubGlobal('matchMedia', implementation)
}

function stubPrefersLight(matches: boolean): void {
  stubMatchMedia((query: string) => {
    const list = { media: query, matches }
    return list as unknown as MediaQueryList
  })
}

function appliedTheme(): string | null {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE)
}

// Шпионы и подмены глобалов снимаются автоматически: restoreMocks и unstubGlobals
// включены в vitest.config.ts. Здесь чистим только то, что переживает тест сам по себе.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('isTheme', () => {
  it('пропускает только известные темы', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('light')).toBe(true)
    expect(isTheme('система')).toBe(false)
    expect(isTheme(null)).toBe(false)
    expect(isTheme(undefined)).toBe(false)
  })
})

describe('applyTheme', () => {
  it.each<Theme>(['dark', 'light'])('ставит data-theme="%s" на <html>', (theme) => {
    expect(applyTheme(theme)).toBe(theme)
    expect(appliedTheme()).toBe(theme)
  })

  it('запоминает выбор в localStorage', () => {
    applyTheme('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    applyTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('с persist=false применяет тему, но не выдаёт её за выбор пользователя', () => {
    applyTheme('light', false)

    expect(appliedTheme()).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('не падает, когда localStorage бросает SecurityError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => applyTheme('light')).not.toThrow()
    expect(appliedTheme()).toBe('light')
  })
})

describe('getSystemTheme', () => {
  it('возвращает светлую, когда система просит светлую', () => {
    stubPrefersLight(true)
    expect(getSystemTheme()).toBe('light')
  })

  it('возвращает тёмную, когда система светлую не просит', () => {
    stubPrefersLight(false)
    expect(getSystemTheme()).toBe('dark')
  })

  it('возвращает тёмную, когда matchMedia недоступен', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(getSystemTheme()).toBe(DEFAULT_THEME)
  })

  it('возвращает тёмную, когда matchMedia бросает исключение', () => {
    stubMatchMedia(() => {
      throw new Error('unsupported media query')
    })

    expect(getSystemTheme()).toBe(DEFAULT_THEME)
  })
})

describe('getInitialTheme', () => {
  it('дефолт берётся из prefers-color-scheme: light', () => {
    stubPrefersLight(true)
    expect(getInitialTheme()).toBe('light')
  })

  it('дефолт берётся из prefers-color-scheme: dark', () => {
    stubPrefersLight(false)
    expect(getInitialTheme()).toBe('dark')
  })

  it('сохранённый выбор перебивает предпочтение системы', () => {
    stubPrefersLight(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(getInitialTheme()).toBe('dark')
  })

  it('мусор в localStorage игнорируется', () => {
    stubPrefersLight(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(getInitialTheme()).toBe('light')
  })
})

describe('getCurrentTheme', () => {
  it('читает применённую тему из атрибута', () => {
    applyTheme('light')
    expect(getCurrentTheme()).toBe('light')
  })

  it('без атрибута откатывается к начальной теме', () => {
    stubPrefersLight(false)
    expect(getCurrentTheme()).toBe('dark')
  })
})

describe('toggleTheme', () => {
  it('переключает тёмную на светлую и обратно', () => {
    applyTheme('dark')

    expect(toggleTheme()).toBe('light')
    expect(appliedTheme()).toBe('light')

    expect(toggleTheme()).toBe('dark')
    expect(appliedTheme()).toBe('dark')
  })

  it('сохраняет каждое переключение', () => {
    applyTheme('dark')
    toggleTheme()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })
})

describe('окружение без DOM', () => {
  it('работает без document и localStorage — SSR не должен падать', () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('localStorage', undefined)
    vi.stubGlobal('matchMedia', undefined)

    expect(applyTheme('light')).toBe('light')
    expect(getInitialTheme()).toBe(DEFAULT_THEME)
    expect(getCurrentTheme()).toBe(DEFAULT_THEME)
    expect(toggleTheme()).toBe('light')
  })
})
