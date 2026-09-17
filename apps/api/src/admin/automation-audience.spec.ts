import { BroadcastAudience } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { audienceOf } from './automation.service'

/**
 * Условие сценария — это фильтр списка гостей, и ничего больше.
 *
 * Проверяем именно перевод: ошибка здесь означает, что сценарий «давно не
 * заходили» напишет не тем людям, а узнается это уже после отправки.
 */

describe('Автосценарии: кому пишем', () => {
  it('«ДАВНО НЕ ЗАХОДИЛИ» — ЭТО СПЯЩИЕ ДОЛЬШЕ ПОРОГА', () => {
    expect(audienceOf('SLEEPING', 30)).toEqual({ sleeping: 30 })
  })

  it('«ВСТУПИЛИ, НО НЕ КУПИЛИ» — ОБА УСЛОВИЯ СРАЗУ, ИНАЧЕ ПИСЬМО УЙДЁТ НАУТРО', () => {
    expect(audienceOf('JOINED_NO_PURCHASE', 7)).toEqual({ buyers: 'none', joinedBefore: 7 })
  })

  it('«СПАСИБО ЗА ПОКУПКИ» СЧИТАЕТСЯ В МИНОРНЫХ ЕДИНИЦАХ', () => {
    expect(audienceOf('SPENT_TOTAL', 1_000_000)).toEqual({ spentFrom: 1_000_000 })
  })

  it('ЛЮБАЯ ИЗ ТРЁХ — ЗАКОННАЯ АУДИТОРИЯ РАССЫЛКИ, А НЕ ПРОСТО ОБЪЕКТ', () => {
    for (const audience of [
      audienceOf('SLEEPING', 30),
      audienceOf('JOINED_NO_PURCHASE', 7),
      audienceOf('SPENT_TOTAL', 1_000_000),
    ]) {
      expect(BroadcastAudience.safeParse(audience).success).toBe(true)
    }
  })
})
