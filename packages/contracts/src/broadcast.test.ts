import { describe, expect, it } from 'vitest'

import { BROADCAST_TEXT_MAX, BroadcastAudience, CreateBroadcastInput } from './broadcast.js'

describe('Рассылки', () => {
  it('АУДИТОРИЯ — ФИЛЬТРЫ СПИСКА ГОСТЕЙ, БЕЗ ЛИСТАНИЯ И ПОИСКА СТРОКОЙ', () => {
    expect(BroadcastAudience.parse({ mode: 'RESIDENT', sleeping: 30 })).toEqual({
      mode: 'RESIDENT',
      sleeping: 30,
    })
    expect(BroadcastAudience.safeParse({ segment: 'AT_RISK' }).success).toBe(true)
    expect(BroadcastAudience.safeParse({ q: 'Анна' }).success).toBe(false)
    expect(BroadcastAudience.safeParse({ limit: 10 }).success).toBe(false)
    expect(BroadcastAudience.safeParse({ sleeping: 3 }).success).toBe(false)
  })

  it('БЕЗ АУДИТОРИИ — ВСЕ ГОСТИ; ТЕКСТ И ИМЯ ОБЯЗАТЕЛЬНЫ', () => {
    expect(CreateBroadcastInput.parse({ title: ' Осень ', text: ' Скучаем! ' })).toEqual({
      title: 'Осень',
      text: 'Скучаем!',
      audience: {},
    })
    expect(CreateBroadcastInput.safeParse({ title: 'Осень', text: ' я ' }).success).toBe(false)
    expect(CreateBroadcastInput.safeParse({ title: 'О', text: 'Текст' }).success).toBe(false)
    expect(
      CreateBroadcastInput.safeParse({ title: 'Осень', text: 'я'.repeat(BROADCAST_TEXT_MAX + 1) })
        .success,
    ).toBe(false)
  })

  it('ОТЛОЖЕННАЯ ОТПРАВКА — МОМЕНТ ISO, МУСОР НЕ ПРОХОДИТ', () => {
    const parsed = CreateBroadcastInput.parse({
      title: 'Осень',
      text: 'Скучаем!',
      sendAt: '2026-09-20T10:00:00.000Z',
    })

    expect(parsed.sendAt).toBe('2026-09-20T10:00:00.000Z')
    expect(
      CreateBroadcastInput.safeParse({ title: 'Осень', text: 'Скучаем!', sendAt: 'завтра' })
        .success,
    ).toBe(false)
  })
})
