import { describe, expect, it } from 'vitest'

import { AdminGuestsQuery } from './admin.js'
import { ReportQuery } from './report.js'
import { RfmSegment } from './rfm.js'

describe('Отчёты: контракт', () => {
  it('ПЕРИОД ПО УМОЛЧАНИЮ — МЕСЯЦ, НЕИЗВЕСТНЫЙ ПЕРИОД — ОТКАЗ', () => {
    expect(ReportQuery.parse({})).toEqual({ period: '30d' })
    expect(ReportQuery.parse({ period: '90d' })).toEqual({ period: '90d' })
    expect(ReportQuery.safeParse({ period: '1y' }).success).toBe(false)
  })

  it('СЕГМЕНТОВ РОВНО ДЕСЯТЬ, И ПО СЕГМЕНТУ ФИЛЬТРУЕТСЯ СПИСОК ГОСТЕЙ', () => {
    expect(RfmSegment.options).toHaveLength(10)
    expect(AdminGuestsQuery.parse({ segment: 'AT_RISK' })).toMatchObject({ segment: 'AT_RISK' })
    expect(AdminGuestsQuery.safeParse({ segment: 'VIP' }).success).toBe(false)
  })
})
