import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { decideClaim } from './telegram-login.service'
import type { ClaimSubject } from './telegram-login.service'

/**
 * Решение по опросу «уже?» — единственное место, где живёт защита входа через
 * Telegram. Поэтому проверяем не «работает ли счастливый путь», а КАЖДЫЙ отказ:
 * счастливый путь виден и глазами, а отсутствующая проверка — нет.
 *
 * Смысл каждого случая: если убрать соответствующую строку в `decideClaim`,
 * должен покраснеть ровно один тест отсюда.
 */

const SECRET = 'секрет-который-принесло-приложение'
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

const NOW = new Date('2026-09-08T10:00:00.000Z')
const LATER = new Date('2026-09-08T10:04:00.000Z')
const EARLIER = new Date('2026-09-08T09:59:00.000Z')

const subject = (patch: Partial<ClaimSubject> = {}): ClaimSubject => ({
  claimSecretHash: hash(SECRET),
  telegramUserId: '778899',
  confirmedAt: EARLIER,
  claimedAt: null,
  expiresAt: LATER,
  ...patch,
})

describe('decideClaim', () => {
  it('выдаёт сессию, когда гость подтвердил вход и секрет тот самый', () => {
    expect(decideClaim(subject(), SECRET, NOW)).toBe('TAKE')
  })

  it('просит подождать, пока гость не нажал «Запустить»', () => {
    expect(decideClaim(subject({ confirmedAt: null, telegramUserId: null }), SECRET, NOW)).toBe(
      'PENDING',
    )
  })

  it('отказывает, если попытки входа нет вовсе', () => {
    expect(decideClaim(null, SECRET, NOW)).toBe('EXPIRED')
  })

  it('отказывает на чужом секрете, даже если вход уже подтверждён', () => {
    // Главная проверка файла. Без неё сессию забирает любой, кто узнал
    // идентификатор попытки, — а идентификатор не секрет.
    expect(decideClaim(subject(), 'не тот секрет', NOW)).toBe('EXPIRED')
  })

  it('отказывает, когда срок ссылки вышел', () => {
    expect(decideClaim(subject({ expiresAt: EARLIER }), SECRET, NOW)).toBe('EXPIRED')
  })

  it('считает истёкшей ссылку, срок которой ровно сейчас', () => {
    // Граница закрыта в сторону отказа: «ровно в срок» — это уже поздно.
    expect(decideClaim(subject({ expiresAt: NOW }), SECRET, NOW)).toBe('EXPIRED')
  })

  it('отказывает во второй раз: сессия забирается однократно', () => {
    expect(decideClaim(subject({ claimedAt: EARLIER }), SECRET, NOW)).toBe('EXPIRED')
  })

  it('не выдаёт сессию, если подтверждение есть, а гостя в нём нет', () => {
    // Состояние невозможное, но проверка дешевле разбирательства: без неё
    // рассинхрон в базе превратился бы во вход неизвестно от чьего имени.
    expect(decideClaim(subject({ telegramUserId: null }), SECRET, NOW)).toBe('PENDING')
  })

  it('различает секреты одинаковой длины', () => {
    // Сравнение идёт по хешам, а они всегда одной длины: проверка на длину
    // не должна подменять собой сравнение.
    const other = SECRET.slice(0, -1) + 'Я'
    expect(other).toHaveLength(SECRET.length)
    expect(decideClaim(subject(), other, NOW)).toBe('EXPIRED')
  })
})
