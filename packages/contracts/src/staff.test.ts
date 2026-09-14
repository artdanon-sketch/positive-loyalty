import { describe, expect, it } from 'vitest'

import { CreateStaffInput, ResetStaffPinInput, StaffPin, UpdateStaffInput } from './staff.js'

/**
 * Схемы команды заведения.
 *
 * Проверяется то, что схема обязана ловить за разработчика: слишком простой PIN,
 * попытку завести владельца и «изменить, не сказав что».
 */

describe('PIN сотрудника', () => {
  it('принимает от четырёх до шести цифр', () => {
    expect(StaffPin.safeParse('4821').success).toBe(true)
    expect(StaffPin.safeParse('482193').success).toBe(true)
  })

  it('не принимает буквы, пробелы и неверную длину', () => {
    expect(StaffPin.safeParse('48a1').success).toBe(false)
    expect(StaffPin.safeParse('482').success).toBe(false)
    expect(StaffPin.safeParse('4821937').success).toBe(false)
    expect(StaffPin.safeParse(' 4821').success).toBe(false)
  })

  it('ОТВЕРГАЕТ ОЧЕВИДНЫЕ PIN', () => {
    // «1111», выданный кассиру, через неделю знает вся смена: его передают
    // как «ну ты понял». Запрет не делает PIN стойким, но убирает самый
    // частый способ, которым он перестаёт быть личным.
    for (const pin of ['0000', '1111', '1234', '123456']) {
      expect(StaffPin.safeParse(pin).success, pin).toBe(false)
    }
  })

  it('объясняет отказ словами, а не кодом', () => {
    const result = StaffPin.safeParse('1234')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('простой')
  })
})

describe('Добавление сотрудника', () => {
  const valid = { displayName: 'Сомчай', role: 'CASHIER', pin: '4821' }

  it('принимает кассира и менеджера', () => {
    expect(CreateStaffInput.safeParse(valid).success).toBe(true)
    expect(CreateStaffInput.safeParse({ ...valid, role: 'MANAGER' }).success).toBe(true)
  })

  it('ВЛАДЕЛЬЦА ЗАВЕСТИ НЕЛЬЗЯ', () => {
    // Передача заведения — событие другого масштаба. Кнопка «сделать
    // владельцем» рядом с «сменить PIN» превращала бы ошибку одного тапа
    // в потерю заведения.
    expect(CreateStaffInput.safeParse({ ...valid, role: 'OWNER' }).success).toBe(false)
  })

  it('лишнее поле не проходит', () => {
    // Без .strict() tenantId из тела молча доехал бы до сервиса.
    expect(CreateStaffInput.safeParse({ ...valid, tenantId: 'чужой' }).success).toBe(false)
  })

  it('обрезает пробелы в имени и не принимает пустое', () => {
    expect(CreateStaffInput.parse({ ...valid, displayName: '  Сомчай  ' }).displayName).toBe(
      'Сомчай',
    )
    expect(CreateStaffInput.safeParse({ ...valid, displayName: '   ' }).success).toBe(false)
  })
})

describe('Изменение сотрудника', () => {
  it('повысить до владельца нельзя', () => {
    expect(UpdateStaffInput.safeParse({ role: 'OWNER' }).success).toBe(false)
  })

  it('пустое тело отвергается', () => {
    expect(UpdateStaffInput.safeParse({}).success).toBe(false)
  })

  it('отключить можно одним полем', () => {
    expect(UpdateStaffInput.parse({ isActive: false })).toEqual({ isActive: false })
  })

  it('новый PIN проходит те же правила', () => {
    expect(ResetStaffPinInput.safeParse({ pin: '0000' }).success).toBe(false)
    expect(ResetStaffPinInput.safeParse({ pin: '7305' }).success).toBe(true)
  })
})
