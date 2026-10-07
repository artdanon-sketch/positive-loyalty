import { describe, expect, it } from 'vitest'

import { posTabs } from './pos-tabs'

describe('Вкладки кассы', () => {
  it('ВСЁ ОТКРЫТО — ЧЕТЫРЕ ВКЛАДКИ, «СЧЁТ» ПЕРВЫМ', () => {
    expect(posTabs({ allowInvite: true, showOwnHistory: true, showOwnStats: true })).toEqual([
      'sale',
      'invite',
      'history',
      'profile',
    ])
  })

  it('ИСТОРИЮ ВЛАДЕЛЕЦ НЕ ОТКРЫВАЛ — ВКЛАДКИ НЕТ ВОВСЕ, А НЕ ВКЛАДКА С ОТКАЗОМ', () => {
    expect(posTabs({ allowInvite: true, showOwnHistory: false })).toEqual([
      'sale',
      'invite',
      'profile',
    ])
  })

  it('СЕРВЕР СТАРШЕ ЭКРАНА И ФЛАГОВ НЕ ПРИСЫЛАЕТ — ТОЛЬКО «СЧЁТ» И «ПРОФИЛЬ»', () => {
    expect(posTabs({})).toEqual(['sale', 'profile'])
  })
})
