import { describe, expect, it } from 'vitest'

import { TelegramMiniAppInput } from './guest.js'

describe('Вход из мини-приложения Telegram', () => {
  it('ПРИНИМАЕТ ТОЛЬКО СТРОКУ ПОДПИСАННЫХ ДАННЫХ, И НИЧЕГО БОЛЬШЕ', () => {
    const initData = 'auth_date=1789600000&user=%7B%22id%22%3A42%7D&hash=' + 'a'.repeat(64)

    expect(TelegramMiniAppInput.parse({ initData })).toEqual({ initData })

    // Назваться гостем напрямую нельзя: личность приносит подпись, а не поле.
    expect(TelegramMiniAppInput.safeParse({ initData, guestId: 'чужой' }).success).toBe(false)
    expect(TelegramMiniAppInput.safeParse({ initData: 'коротко' }).success).toBe(false)
    expect(TelegramMiniAppInput.safeParse({ initData: 'я'.repeat(4097) }).success).toBe(false)
  })
})
