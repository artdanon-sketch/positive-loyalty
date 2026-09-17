import { describe, expect, it } from 'vitest'

import { keyToBytes, pushState } from './push-support'

/**
 * Ошибка в переводе ключа не падает и не ругается — она просто оставляет гостя
 * без уведомлений навсегда. Поэтому проверяется побайтно.
 */

const env = (extra: Partial<Parameters<typeof pushState>[0]> = {}) => ({
  supported: true,
  serverReady: true,
  permission: 'default' as NotificationPermission,
  subscribed: false,
  ...extra,
})

describe('Уведомления: что показывать гостю', () => {
  it('БРАУЗЕР НЕ УМЕЕТ ИЛИ СЕРВЕР НЕ НАСТРОЕН — БЛОКА НЕТ ВОВСЕ', () => {
    expect(pushState(env({ supported: false }))).toEqual({ kind: 'hidden' })
    expect(pushState(env({ serverReady: false }))).toEqual({ kind: 'hidden' })
  })

  it('ЗАПРЕТ — ЭТО ОБЪЯСНЕНИЕ, А НЕ КНОПКА: БРАУЗЕР ВТОРОЙ РАЗ НЕ СПРОСИТ', () => {
    expect(pushState(env({ permission: 'denied', subscribed: true }))).toEqual({ kind: 'blocked' })
  })

  it('ПОДПИСКА БЕЗ РАЗРЕШЕНИЯ — ЭТО ЕЩЁ НЕ «ВКЛЮЧЕНО»', () => {
    expect(pushState(env({ subscribed: true, permission: 'default' }))).toEqual({ kind: 'ready' })
    expect(pushState(env({ subscribed: true, permission: 'granted' }))).toEqual({ kind: 'on' })
  })

  it('РАЗРЕШЕНИЕ БЕЗ ПОДПИСКИ — ПРЕДЛАГАЕМ ВКЛЮЧИТЬ: УСТРОЙСТВО ЕЩЁ НЕ ЗАПИСАНО', () => {
    expect(pushState(env({ permission: 'granted' }))).toEqual({ kind: 'ready' })
  })
})

describe('Уведомления: ключ сервера', () => {
  it('BASE64URL ПЕРЕВОДИТСЯ ПОБАЙТНО, А НЕ ЧЕРЕЗ ОБЫЧНЫЙ BASE64', () => {
    // «-» и «_» в base64url — это «+» и «/»: обычный atob дал бы мусор.
    const bytes = keyToBytes('-_8')

    expect(Array.from(bytes)).toEqual([251, 255])
  })

  it('ВЫРАВНИВАНИЕ ДОСТАВЛЯЕТСЯ САМО: СЕРВЕР ПРИСЫЛАЕТ КЛЮЧ БЕЗ «=»', () => {
    expect(Array.from(keyToBytes('QQ'))).toEqual([65])
    expect(Array.from(keyToBytes('QUJD'))).toEqual([65, 66, 67])
  })
})
