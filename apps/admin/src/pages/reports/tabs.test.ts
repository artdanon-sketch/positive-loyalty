import { describe, expect, it } from 'vitest'

import { tabFromParams } from './tabs'

describe('Вкладка отчётов в адресе', () => {
  it('ВКЛАДКА ЧИТАЕТСЯ ИЗ АДРЕСА, НЕИЗВЕСТНАЯ — «КЛИЕНТЫ»', () => {
    expect(tabFromParams(new URLSearchParams('tab=rfm'))).toBe('rfm')
    expect(tabFromParams(new URLSearchParams('tab=staff'))).toBe('staff')
    expect(tabFromParams(new URLSearchParams('tab=profit'))).toBe('customers')
    expect(tabFromParams(new URLSearchParams(''))).toBe('customers')
  })
})
