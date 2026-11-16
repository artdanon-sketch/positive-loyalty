import { describe, expect, it } from 'vitest'

import { apiCorsOrigins } from './api-cors-origins'

describe('Адреса, которым API отвечает на CORS', () => {
  it('ПРИЛОЖЕНИЕ НА ТЕЛЕФОНЕ ПУСКАЕТСЯ, ДАЖЕ ЕСЛИ ВЫКЛАДКА ЗАДАЛА ТОЛЬКО САЙТЫ', () => {
    expect(apiCorsOrigins(['https://positive-loyalty.pages.dev'])).toEqual([
      'https://positive-loyalty.pages.dev',
      'https://localhost',
    ])
  })

  it('АДРЕС ПРИЛОЖЕНИЯ, ЗАДАННЫЙ И В ПЕРЕМЕННОЙ, НЕ ДВОИТСЯ', () => {
    expect(apiCorsOrigins(['https://localhost', 'https://positive-guest.pages.dev'])).toEqual([
      'https://localhost',
      'https://positive-guest.pages.dev',
    ])
  })

  it('ЧУЖИХ АДРЕСОВ И ОБОЛОЧКИ iOS, КОТОРОЙ НЕТ, В СПИСКЕ НЕТ', () => {
    const origins = apiCorsOrigins([])

    expect(origins).toEqual(['https://localhost'])
    expect(origins).not.toContain('capacitor://localhost')
  })
})
