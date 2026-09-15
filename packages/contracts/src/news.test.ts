import { describe, expect, it } from 'vitest'

import { CreateNewsInput, UpdateNewsInput } from './news.js'

describe('Новости', () => {
  it('ЧЕРНОВИК ПО УМОЛЧАНИЮ, ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ', () => {
    expect(
      CreateNewsInput.parse({ title: ' Новое меню ', body: ' С понедельника — суп дня ' }),
    ).toEqual({
      title: 'Новое меню',
      body: 'С понедельника — суп дня',
      publish: false,
    })
  })

  it('ЗАГОЛОВОК ОТ 2 ДО 120, ТЕКСТ НЕ ПУСТОЙ И НЕ ДЛИННЕЕ 2000', () => {
    expect(CreateNewsInput.safeParse({ title: 'Н', body: 'Текст' }).success).toBe(false)
    expect(CreateNewsInput.safeParse({ title: 'я'.repeat(121), body: 'Текст' }).success).toBe(false)
    expect(CreateNewsInput.safeParse({ title: 'Меню', body: '   ' }).success).toBe(false)
    expect(CreateNewsInput.safeParse({ title: 'Меню', body: 'я'.repeat(2001) }).success).toBe(false)
  })

  it('ПРАВКА — ХОТЯ БЫ ОДНО ПОЛЕ; ЛИШНИЕ ПОЛЯ — НЕТ', () => {
    expect(UpdateNewsInput.safeParse({ isPublished: false }).success).toBe(true)
    expect(UpdateNewsInput.safeParse({}).success).toBe(false)
    expect(UpdateNewsInput.safeParse({ tenantId: 'чужой' }).success).toBe(false)
  })
})
