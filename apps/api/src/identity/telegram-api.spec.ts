import { describe, expect, it } from 'vitest'

import { parseStart } from './telegram-api'
import type { TelegramUpdate } from './telegram-api'

/**
 * Разбор сообщений бота. Всё, что приходит от Telegram, — чужой ввод
 * (docs/05, API10: вебхук проверяется как пользовательский ввод, а не как
 * доверенный источник). Поэтому проверяем в первую очередь то, что НЕ должно
 * приниматься за команду входа.
 */

const update = (message: Record<string, unknown> | undefined): TelegramUpdate =>
  ({ update_id: 42, ...(message === undefined ? {} : { message }) }) as TelegramUpdate

const person = {
  id: 778899,
  is_bot: false,
  first_name: 'Анна',
  last_name: 'К',
  language_code: 'ru',
}

const privateChat = { id: 778899, type: 'private' }

describe('parseStart', () => {
  it('разбирает «Запустить» с кодом из ссылки', () => {
    const result = parseStart(
      update({ from: person, chat: privateChat, text: '/start AbC-123_xyz' }),
    )

    expect(result).toEqual({
      updateId: 42,
      userId: '778899',
      chatId: '778899',
      displayName: 'Анна К',
      locale: 'ru',
      payload: 'AbC-123_xyz',
    })
  })

  it('принимает «Запустить» без кода — гость открыл бота сам', () => {
    expect(parseStart(update({ from: person, chat: privateChat, text: '/start' }))?.payload).toBe(
      null,
    )
  })

  it('принимает форму с именем бота', () => {
    const result = parseStart(
      update({ from: person, chat: privateChat, text: '/start@positive_bot код' }),
    )

    expect(result?.payload).toBe('код')
  })

  it('не принимает обычный текст за команду', () => {
    expect(parseStart(update({ from: person, chat: privateChat, text: 'привет' }))).toBe(null)
  })

  it('не принимает команду, к которой дописали лишнее', () => {
    // «/startle» — не «/start». Без границы слова сюда прошла бы любая
    // команда, начинающаяся с этих букв.
    expect(parseStart(update({ from: person, chat: privateChat, text: '/startle код' }))).toBe(null)
  })

  it('не принимает команду с двумя словами после неё', () => {
    // Код в ссылке — одно слово. Два означают, что это не наша ссылка.
    expect(parseStart(update({ from: person, chat: privateChat, text: '/start код ещё' }))).toBe(
      null,
    )
  })

  it('игнорирует групповые чаты', () => {
    // Иначе кто угодно добавляет бота в группу, пишет туда чужой код
    // из ссылки — и подтверждает вход вместо владельца ссылки.
    const result = parseStart(
      update({ from: person, chat: { id: -100, type: 'supergroup' }, text: '/start код' }),
    )

    expect(result).toBe(null)
  })

  it('игнорирует сообщения от других ботов', () => {
    const bot = { ...person, is_bot: true }
    expect(parseStart(update({ from: bot, chat: privateChat, text: '/start код' }))).toBe(null)
  })

  it('игнорирует обновления без сообщения', () => {
    expect(parseStart(update(undefined))).toBe(null)
  })

  it('игнорирует сообщение без отправителя', () => {
    expect(parseStart(update({ chat: privateChat, text: '/start код' }))).toBe(null)
  })

  it('приводит язык к четырём языкам продукта', () => {
    const withLang = (code: string | undefined): string | undefined =>
      parseStart(
        update({
          from: { ...person, ...(code === undefined ? {} : { language_code: code }) },
          chat: privateChat,
          text: '/start код',
        }),
      )?.locale

    expect(withLang('en')).toBe('en')
    expect(withLang('th')).toBe('th')
    // Китайский приходит с областью — берём язык, а не весь код.
    expect(withLang('zh-hans')).toBe('zh')
    // Незнакомый язык не выдумываем: русский лучше пустых строк перевода.
    expect(withLang('de')).toBe('ru')
    expect(withLang(undefined)).toBe('ru')
  })

  it('обходится без имени, если профиль пуст', () => {
    const nameless = { id: 1, is_bot: false }
    expect(
      parseStart(update({ from: nameless, chat: { id: 1, type: 'private' }, text: '/start код' }))
        ?.displayName,
    ).toBe(null)
  })
})
