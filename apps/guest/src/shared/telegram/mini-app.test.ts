import { afterEach, describe, expect, it, vi } from 'vitest'

import { insideTelegram, telegramColorScheme, telegramInitData, telegramReady } from './mini-app'

/**
 * Всё, что приходит из окружения Telegram, — чужое: клиент может быть старым,
 * полей может не быть, окна может не быть вовсе. Проверяем каждый такой случай.
 */

const setWebApp = (webApp: unknown): void => {
  ;(globalThis as unknown as Record<string, unknown>)['Telegram'] = { WebApp: webApp }
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['Telegram']
})

describe('Окружение мини-приложения Telegram', () => {
  it('БЕЗ TELEGRAM — НЕ ВНУТРИ, ПОДПИСИ НЕТ, ТЕМЫ НЕТ', () => {
    expect(insideTelegram()).toBe(false)
    expect(telegramInitData()).toBeNull()
    expect(telegramColorScheme()).toBeNull()
    // Команды окну без окна — не ошибка, а тишина.
    expect(() => {
      telegramReady()
    }).not.toThrow()
  })

  it('ОКНО ЕСТЬ, НО ПОДПИСИ НЕТ — ВХОДИТЬ НЕЧЕМ', () => {
    setWebApp({ initData: '' })

    expect(insideTelegram()).toBe(true)
    expect(telegramInitData()).toBeNull()
  })

  it('ПОДПИСЬ ЕСТЬ — ОТДАЁМ ЕЁ КАК ЕСТЬ', () => {
    setWebApp({ initData: 'auth_date=1&hash=abc', colorScheme: 'dark' })

    expect(telegramInitData()).toBe('auth_date=1&hash=abc')
    expect(telegramColorScheme()).toBe('dark')
  })

  it('СТАРЫЙ КЛИЕНТ БЕЗ ready И expand НЕ РОНЯЕТ КАРТУ', () => {
    setWebApp({ initData: 'x' })

    expect(() => {
      telegramReady()
    }).not.toThrow()
  })

  it('НОВЫЙ КЛИЕНТ: СНИМАЕМ ЗАСТАВКУ И РАЗВОРАЧИВАЕМ ОКНО', () => {
    const ready = vi.fn()
    const expand = vi.fn()
    setWebApp({ initData: 'x', ready, expand })

    telegramReady()

    expect(ready).toHaveBeenCalledOnce()
    expect(expand).toHaveBeenCalledOnce()
  })

  it('НЕИЗВЕСТНАЯ ТЕМА — НЕ НАВЯЗЫВАЕМ', () => {
    setWebApp({ initData: 'x', colorScheme: 'sepia' })

    expect(telegramColorScheme()).toBeNull()
  })
})
