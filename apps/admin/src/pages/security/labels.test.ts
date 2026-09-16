import { describe, expect, it } from 'vitest'

import { t } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { actionLabel, dayLabel } from './labels'

const ru = (key: TranslationKey): string => t(key)

describe('Подписи безопасности', () => {
  it('ДЕЙСТВИЕ АУДИТА — СЛОВАМИ, НЕИЗВЕСТНЫЙ КОД — КАК ЕСТЬ', () => {
    expect(actionLabel('STAFF_PIN_RESET', ru)).toBe(t('security.action.STAFF_PIN_RESET'))
    expect(actionLabel('SOMETHING_NEW', ru)).toBe('SOMETHING_NEW')
  })

  it('день заведения — числом вперёд, без часового пояса', () => {
    expect(dayLabel('2026-09-15')).toBe('15.09.2026')
  })
})
