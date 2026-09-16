import { describe, expect, it } from 'vitest'

import {
  AdminMessagesQuery,
  CreateGuestMessageInput,
  GUEST_MESSAGE_TEXT_MAX,
  ReplyGuestMessageInput,
} from './guest-message.js'

const TENANT = '3b3b3b3b-3b3b-43b3-83b3-3b3b3b3b3b3b'

describe('Жалобы и предложения', () => {
  it('ОБРАЩЕНИЕ — ЗАВЕДЕНИЕ, ВИД И ТЕКСТ; ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ', () => {
    expect(
      CreateGuestMessageInput.parse({
        tenantId: TENANT,
        kind: 'COMPLAINT',
        text: '  Кондиционер не работает  ',
      }),
    ).toEqual({ tenantId: TENANT, kind: 'COMPLAINT', text: 'Кондиционер не работает' })
  })

  it('ТЕКСТ ОТ 2 ДО 1000 ЗНАКОВ, ВИД ТОЛЬКО ИЗ ДВУХ, ЛИШНИЕ ПОЛЯ — НЕТ', () => {
    const base = { tenantId: TENANT, kind: 'SUGGESTION' as const }

    expect(CreateGuestMessageInput.safeParse({ ...base, text: ' я ' }).success).toBe(false)
    expect(
      CreateGuestMessageInput.safeParse({ ...base, text: 'я'.repeat(GUEST_MESSAGE_TEXT_MAX + 1) })
        .success,
    ).toBe(false)
    expect(
      CreateGuestMessageInput.safeParse({ ...base, kind: 'PRAISE', text: 'Текст' }).success,
    ).toBe(false)
    expect(
      CreateGuestMessageInput.safeParse({ ...base, text: 'Текст', guestId: 'чужой' }).success,
    ).toBe(false)
  })

  it('СПИСОК БЭК-ОФИСА: ПО УМОЛЧАНИЮ ПЕРВЫЕ ДВАДЦАТЬ БЕЗ ФИЛЬТРОВ', () => {
    expect(AdminMessagesQuery.parse({})).toEqual({ limit: 20, offset: 0 })
    expect(AdminMessagesQuery.parse({ kind: 'COMPLAINT', answered: 'no', limit: '5' })).toEqual({
      kind: 'COMPLAINT',
      answered: 'no',
      limit: 5,
      offset: 0,
    })
    expect(AdminMessagesQuery.safeParse({ answered: 'может быть' }).success).toBe(false)
    expect(AdminMessagesQuery.safeParse({ limit: '101' }).success).toBe(false)
  })

  it('ОТВЕТ — НЕ ПУСТОЙ И НЕ ДЛИННЕЕ ТЫСЯЧИ', () => {
    expect(ReplyGuestMessageInput.parse({ text: ' Починили ' })).toEqual({ text: 'Починили' })
    expect(ReplyGuestMessageInput.safeParse({ text: '   ' }).success).toBe(false)
    expect(ReplyGuestMessageInput.safeParse({ text: 'я'.repeat(1001) }).success).toBe(false)
  })
})
