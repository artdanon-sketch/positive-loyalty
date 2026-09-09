import { describe, expect, it } from 'vitest'

import { PlatformSignInInput } from './platform.js'

/**
 * Контракт входа в админку платформы.
 *
 * ─── Почему эти тесты появились ──────────────────────────────────────────────
 *
 * Не «для полноты». Контроллер сначала принимал тело как типизированный
 * параметр — а тип при сборке стирается и не проверяет ничего. Пустое тело
 * доходило до сервиса и роняло его пятисоткой вместо честного «неверный запрос».
 *
 * Нашлось это проверкой ЖИВОГО сервиса после выкладки, а не тестом: у контроллера
 * его не было вовсе. Отсюда эти проверки — они сторожат сам контракт, независимо
 * от того, кто и как его применяет.
 */

const valid = {
  email: 'admin@example.test',
  password: 'достаточно-длинный-пароль',
  totpCode: '123456',
  deviceId: 'x'.repeat(16),
}

describe('PlatformSignInInput', () => {
  it('принимает полный корректный вход', () => {
    expect(PlatformSignInInput.safeParse(valid).success).toBe(true)
  })

  it('ПУСТОЕ ТЕЛО отвергает — ровно этот случай ронял сервис', () => {
    const parsed = PlatformSignInInput.safeParse({})

    expect(parsed.success).toBe(false)
  })

  it('отвергает отсутствие любого обязательного поля по отдельности', () => {
    for (const field of ['email', 'password', 'totpCode', 'deviceId'] as const) {
      const body: Record<string, unknown> = { ...valid }
      delete body[field]

      expect(PlatformSignInInput.safeParse(body).success, `без поля ${field}`).toBe(false)
    }
  })

  it('приводит почту к нижнему регистру и обрезает пробелы', () => {
    const parsed = PlatformSignInInput.safeParse({ ...valid, email: '  ADMIN@Example.TEST ' })

    expect(parsed.success && parsed.data.email).toBe('admin@example.test')
  })

  it('короткий пароль не принимает', () => {
    // Двенадцать символов — не придирка: у этой учётной записи нет заведения,
    // за которым можно спрятаться, она видит всех сразу.
    expect(PlatformSignInInput.safeParse({ ...valid, password: 'коротко' }).success).toBe(false)
  })

  it('код принимает шестизначный, в том числе с пробелом посередине', () => {
    // Аутентификаторы показывают код как «123 456», и ровно так его копируют.
    expect(PlatformSignInInput.safeParse({ ...valid, totpCode: '123 456' }).success).toBe(true)
  })

  it('код не той длины и не из цифр не принимает', () => {
    for (const totpCode of ['12345', '1234567', 'abcdef', '', '12 34 56']) {
      expect(PlatformSignInInput.safeParse({ ...valid, totpCode }).success, totpCode).toBe(false)
    }
  })

  it('короткий идентификатор устройства не принимает', () => {
    // Он взял на себя роль IP-allowlist: короткий легко подобрать целиком.
    expect(PlatformSignInInput.safeParse({ ...valid, deviceId: 'коротко' }).success).toBe(false)
  })

  it('ЛИШНИЕ ПОЛЯ отвергает — .strict() против mass assignment', () => {
    const parsed = PlatformSignInInput.safeParse({ ...valid, isAdmin: true, tenantId: 'чужой' })

    expect(parsed.success).toBe(false)
  })
})
