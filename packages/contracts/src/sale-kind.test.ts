import { describe, expect, it } from 'vitest'

import { CreateSaleKindInput, UpdateSaleKindInput } from './sale-kind.js'

/**
 * Схемы справочника видов продаж.
 *
 * Проверяется то, что схема обязана ловить ЗА разработчика: лишние поля,
 * пустое название и «изменить, не сказав что». Всё это доходит до сервиса
 * молча, если схема пропускает.
 */

describe('Заведение вида продажи', () => {
  it('обрезает пробелы вокруг названия', () => {
    const parsed = CreateSaleKindInput.parse({ name: '  Абонемент  ' })

    // Иначе «Абонемент» и «Абонемент » — два разных вида в одном списке,
    // и UNIQUE их не поймает: для базы это разные строки.
    expect(parsed.name).toBe('Абонемент')
  })

  it('ОТВЕРГАЕТ НАЗВАНИЕ ИЗ ОДНИХ ПРОБЕЛОВ', () => {
    // После обрезки остаётся пустая строка. Пустое название в списке
    // у кассира — это пункт, который невозможно выбрать осознанно.
    expect(CreateSaleKindInput.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('порядок по умолчанию нулевой', () => {
    expect(CreateSaleKindInput.parse({ name: 'Разовое занятие' }).sortOrder).toBe(0)
  })

  it('ЛИШНЕЕ ПОЛЕ НЕ ПРОХОДИТ', () => {
    // .strict() — единственное, что стоит между запросом и mass assignment:
    // без него tenantId или isActive из тела молча доехали бы до сервиса.
    expect(CreateSaleKindInput.safeParse({ name: 'Абонемент', tenantId: 'чужой' }).success).toBe(
      false,
    )
  })
})

describe('Изменение вида продажи', () => {
  it('меняет по одному полю', () => {
    expect(UpdateSaleKindInput.parse({ isActive: false })).toEqual({ isActive: false })
  })

  it('ПУСТОЕ ТЕЛО ОТВЕРГАЕТСЯ', () => {
    // «Изменить, не сказав что» — почти всегда потерянное поле на клиенте.
    // Молчаливое согласие вернуло бы 200 и ничего не изменило.
    expect(UpdateSaleKindInput.safeParse({}).success).toBe(false)
  })

  it('удаления нет: поля deleted в схеме не существует', () => {
    // Вид, на который ссылается журнал, исчезнуть не может — иначе по журналу
    // нельзя разобрать ни отчёт, ни спор. Ненужное выключается isActive.
    expect(UpdateSaleKindInput.safeParse({ deleted: true }).success).toBe(false)
  })
})
