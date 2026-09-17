import type { ProgramSettings } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { sameProgramSettings } from './program-draft'

/**
 * Ошибка здесь не падает, а тихо портит форму: «сохранить» либо горит на
 * нетронутых настройках, либо не загорается на изменённых.
 */

const settings = (extra: Partial<ProgramSettings['cashierRules']> = {}): ProgramSettings => ({
  baseEarnRate: 5,
  baseRedeemRate: 30,
  cashierRules: {
    requireReceiptNumber: true,
    maxManualAmount: null,
    allowManualEntry: true,
    ...extra,
  },
})

describe('Настройки программы: изменилось или нет', () => {
  it('ОДИНАКОВЫЕ НАСТРОЙКИ РАВНЫ', () => {
    expect(sameProgramSettings(settings(), settings())).toBe(true)
  })

  it('ОТСУТСТВУЮЩЕЕ ПОЛЕ РАВНО ВЫКЛЮЧЕННОМУ: СТАРЫЙ СЕРВЕР ЕГО НЕ ПРИСЫЛАЕТ', () => {
    expect(sameProgramSettings(settings({ showGuestTags: false }), settings())).toBe(true)
    expect(sameProgramSettings(settings({ allowTagging: false }), settings())).toBe(true)
  })

  it('ВКЛЮЧЁННАЯ НАСТРОЙКА ОТЛИЧАЕТСЯ ОТ ОТСУТСТВУЮЩЕЙ', () => {
    expect(sameProgramSettings(settings({ showGuestTags: true }), settings())).toBe(false)
  })

  it('РАЗНЫЕ ПРОЦЕНТЫ И ПОТОЛОК — ЭТО ИЗМЕНЕНИЕ', () => {
    const changed = { ...settings(), baseEarnRate: 7 }
    expect(sameProgramSettings(changed, settings())).toBe(false)

    expect(sameProgramSettings(settings({ maxManualAmount: 300_000 }), settings())).toBe(false)
  })

  it('ПОРЯДОК ПОЛЕЙ НЕ ВЛИЯЕТ — В ЭТОМ И БЫЛ СМЫСЛ ОТКАЗА ОТ СРАВНЕНИЯ СТРОК', () => {
    const reordered: ProgramSettings = {
      baseRedeemRate: 30,
      baseEarnRate: 5,
      cashierRules: {
        allowManualEntry: true,
        maxManualAmount: null,
        requireReceiptNumber: true,
      },
    }

    expect(sameProgramSettings(settings(), reordered)).toBe(true)
  })
})
