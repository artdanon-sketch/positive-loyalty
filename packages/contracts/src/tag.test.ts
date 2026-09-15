import { describe, expect, it } from 'vitest'

import { CreateTagInput, SetGuestTagsInput, UpdateTagInput } from './tag.js'

const VIP = '11111111-1111-4111-8111-111111111111'
const ALLERGY = '22222222-2222-4222-8222-222222222222'

describe('Теги: контракт', () => {
  it('тег заводится с названием; цвет по умолчанию — нейтральный', () => {
    expect(CreateTagInput.parse({ name: ' VIP ' })).toEqual({ name: 'VIP', color: 'slate' })
    expect(CreateTagInput.safeParse({ name: 'Аллергия', color: 'rose' }).success).toBe(true)
  })

  it('ЦВЕТ — ТОЛЬКО ИЗ ТОКЕНОВ; НАЗВАНИЕ — ОТ 1 ДО 40 ЗНАКОВ', () => {
    expect(CreateTagInput.safeParse({ name: 'VIP', color: '#ff0000' }).success).toBe(false)
    expect(CreateTagInput.safeParse({ name: '   ' }).success).toBe(false)
    expect(CreateTagInput.safeParse({ name: 'я'.repeat(41) }).success).toBe(false)
  })

  it('правка без полей — нечего менять', () => {
    expect(UpdateTagInput.safeParse({}).success).toBe(false)
    expect(UpdateTagInput.safeParse({ color: 'mint' }).success).toBe(true)
  })

  it('ТЕГИ ГОСТЯ — НАБОРОМ: ПУСТОЙ СНИМАЕТ ВСЕ, ОДИН ТЕГ ДВАЖДЫ И НЕ-ID — ОТКАЗ', () => {
    expect(SetGuestTagsInput.safeParse({ tagIds: [] }).success).toBe(true)
    expect(SetGuestTagsInput.safeParse({ tagIds: [VIP, ALLERGY] }).success).toBe(true)
    expect(SetGuestTagsInput.safeParse({ tagIds: [VIP, VIP] }).success).toBe(false)
    expect(SetGuestTagsInput.safeParse({ tagIds: ['VIP'] }).success).toBe(false)
  })
})
