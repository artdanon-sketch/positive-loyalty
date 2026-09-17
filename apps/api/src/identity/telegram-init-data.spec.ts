import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { TelegramInitDataError, verifyTelegramInitData } from './telegram-init-data'

/**
 * Здесь решается, пускать ли человека в чужую карту, — поэтому проверяется
 * каждая ветка отказа, а не только счастливый путь.
 */

const BOT = '7777777:AAHfake-token-for-tests-only'
const NOW = new Date('2026-09-17T12:00:00.000Z')

/** Подписать поля так же, как это делает Telegram. */
const sign = (fields: Record<string, string>, botToken = BOT): string => {
  const checkString = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(checkString).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)

  return params.toString()
}

const user = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: 4242, first_name: 'Аня', last_name: 'К', language_code: 'ru', ...extra })

const fresh = (extra: Record<string, string> = {}): Record<string, string> => ({
  auth_date: String(Math.floor(NOW.getTime() / 1000) - 10),
  query_id: 'AAE',
  user: user(),
  ...extra,
})

describe('Вход через мини-приложение Telegram', () => {
  it('ПОДПИСЬ СОШЛАСЬ — ОТДАЁМ ЧЕЛОВЕКА: НОМЕР, ИМЯ И ЯЗЫК', () => {
    const result = verifyTelegramInitData(sign(fresh()), BOT, NOW)

    expect(result).toEqual({ id: '4242', displayName: 'Аня К', languageCode: 'ru' })
  })

  it('ЧУЖОЙ БОТ ПОДПИСАЛ — НЕ ПУСКАЕМ', () => {
    const foreign = sign(fresh(), '1111111:BBanother-bot')

    expect(() => verifyTelegramInitData(foreign, BOT, NOW)).toThrow(TelegramInitDataError)
  })

  it('ПОЛЕ ПОДМЕНИЛИ ПОСЛЕ ПОДПИСИ — НЕ ПУСКАЕМ', () => {
    const params = new URLSearchParams(sign(fresh()))
    params.set('user', user({ id: 9999 }))

    expect(() => verifyTelegramInitData(params.toString(), BOT, NOW)).toThrow(/подпись не сошлась/)
  })

  it('ПОДПИСЬ СТАРШЕ СУТОК — НЕ ПУСКАЕМ: СТРОКА НЕ ОДНОРАЗОВАЯ', () => {
    const old = sign(fresh({ auth_date: String(Math.floor(NOW.getTime() / 1000) - 25 * 3600) }))

    expect(() => verifyTelegramInitData(old, BOT, NOW)).toThrow(/старше суток/)
  })

  it('ЧАСЫ РАЗОШЛИСЬ НА СЕКУНДЫ — ПУСКАЕМ; НА ЧАС ВПЕРЁД — НЕТ', () => {
    const skewed = sign(fresh({ auth_date: String(Math.floor(NOW.getTime() / 1000) + 30) }))
    expect(verifyTelegramInitData(skewed, BOT, NOW).id).toBe('4242')

    const future = sign(fresh({ auth_date: String(Math.floor(NOW.getTime() / 1000) + 3600) }))
    expect(() => verifyTelegramInitData(future, BOT, NOW)).toThrow(/из будущего/)
  })

  it('НЕИЗВЕСТНОЕ ПОЛЕ TELEGRAM НЕ ЛОМАЕТ ПРОВЕРКУ', () => {
    const withNewField = sign(fresh({ chat_type: 'private', signature: 'abc' }))

    expect(verifyTelegramInitData(withNewField, BOT, NOW).id).toBe('4242')
  })

  it('БЕЗ ПОДПИСИ, БЕЗ ЧЕЛОВЕКА И БЕЗ ТОКЕНА БОТА — ОТКАЗ С ПРИЧИНОЙ', () => {
    expect(() => verifyTelegramInitData('user=%7B%7D', BOT, NOW)).toThrow(/нет подписи/)

    const noUser = sign({ auth_date: String(Math.floor(NOW.getTime() / 1000)), query_id: 'AAE' })
    expect(() => verifyTelegramInitData(noUser, BOT, NOW)).toThrow(/нет пользователя/)

    expect(() => verifyTelegramInitData(sign(fresh()), '   ', NOW)).toThrow(/токен бота не задан/)
  })

  it('ИМЕНИ МОЖЕТ НЕ БЫТЬ — ЭТО НЕ ОШИБКА', () => {
    const anonymous = sign(fresh({ user: JSON.stringify({ id: 77 }) }))

    expect(verifyTelegramInitData(anonymous, BOT, NOW)).toEqual({
      id: '77',
      displayName: null,
      languageCode: null,
    })
  })
})
