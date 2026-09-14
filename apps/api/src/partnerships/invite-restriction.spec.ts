import { describe, expect, it } from 'vitest'

import {
  COOLING_FREE_INVITES,
  coolingUntil,
  freeInvitesUnder,
  inviteRestriction,
  restrictionView,
} from './invite-restriction'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-15T12:00:00.000Z')

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS)
const monthAfter = (date: Date): Date => new Date(date.getTime() + 30 * DAY_MS)

describe('Автоохлаждение: три отказа от разных получателей за неделю', () => {
  it('два отказа — охлаждения нет', () => {
    expect(
      coolingUntil(
        [
          { from: 'a', at: daysAgo(2) },
          { from: 'b', at: daysAgo(1) },
        ],
        NOW,
      ),
    ).toBeNull()
  })

  it('ТРЕТИЙ ОТКАЗ ЗА НЕДЕЛЮ — ОХЛАЖДЕНИЕ НА 30 ДНЕЙ ОТ НЕГО', () => {
    expect(
      coolingUntil(
        [
          { from: 'a', at: daysAgo(6) },
          { from: 'b', at: daysAgo(3) },
          { from: 'c', at: daysAgo(1) },
        ],
        NOW,
      ),
    ).toEqual(monthAfter(daysAgo(1)))
  })

  it('порядок отказов на входе не важен', () => {
    expect(
      coolingUntil(
        [
          { from: 'c', at: daysAgo(1) },
          { from: 'a', at: daysAgo(6) },
          { from: 'b', at: daysAgo(3) },
        ],
        NOW,
      ),
    ).toEqual(monthAfter(daysAgo(1)))
  })

  it('граница окна: ровно семь дней между первым и третьим — уже не неделя', () => {
    expect(
      coolingUntil(
        [
          { from: 'a', at: daysAgo(8) },
          { from: 'b', at: daysAgo(4) },
          { from: 'c', at: daysAgo(1) },
        ],
        NOW,
      ),
    ).toBeNull()
  })

  it('один получатель, отказавший трижды, — один отказ', () => {
    expect(
      coolingUntil(
        [
          { from: 'a', at: daysAgo(3) },
          { from: 'a', at: daysAgo(2) },
          { from: 'a', at: daysAgo(1) },
        ],
        NOW,
      ),
    ).toBeNull()
  })

  it('через 30 дней после третьего отказа охлаждение кончается', () => {
    const declines = [
      { from: 'a', at: daysAgo(33) },
      { from: 'b', at: daysAgo(32) },
      { from: 'c', at: daysAgo(31) },
    ]

    expect(coolingUntil(declines, NOW)).toBeNull()
    expect(coolingUntil(declines, daysAgo(2))).toEqual(daysAgo(1))
  })

  it('новая волна отказов во время охлаждения продлевает его', () => {
    expect(
      coolingUntil(
        [
          { from: 'a', at: daysAgo(20) },
          { from: 'b', at: daysAgo(19) },
          { from: 'c', at: daysAgo(18) },
          { from: 'd', at: daysAgo(3) },
          { from: 'e', at: daysAgo(2) },
          { from: 'f', at: daysAgo(1) },
        ],
        NOW,
      ),
    ).toEqual(monthAfter(daysAgo(1)))
  })
})

describe('Жалобы и итоговое ограничение', () => {
  const cooling = [
    { from: 'a', at: daysAgo(3) },
    { from: 'b', at: daysAgo(2) },
    { from: 'c', at: daysAgo(1) },
  ]

  it('ПЯТЬ НЕРАЗОБРАННЫХ ЖАЛОБ — ПРИГЛАШАТЬ НЕЛЬЗЯ, И ЭТО СИЛЬНЕЕ ОХЛАЖДЕНИЯ', () => {
    const restriction = inviteRestriction({ declines: cooling, openComplaints: 5, now: NOW })

    expect(restriction).toEqual({ kind: 'SUSPENDED' })
    expect(freeInvitesUnder(3, restriction)).toBe(0)
    expect(restrictionView(restriction)).toEqual({ kind: 'SUSPENDED' })
  })

  it('четыре жалобы — ещё не приостановка', () => {
    expect(inviteRestriction({ declines: [], openComplaints: 4, now: NOW })).toEqual({
      kind: 'NONE',
    })
  })

  it('на охлаждении — одно бесплатное в сутки, но не больше прайса', () => {
    const restriction = inviteRestriction({ declines: cooling, openComplaints: 0, now: NOW })

    expect(restriction).toEqual({ kind: 'COOLING', until: monthAfter(daysAgo(1)) })
    expect(freeInvitesUnder(3, restriction)).toBe(COOLING_FREE_INVITES)
    expect(freeInvitesUnder(0, restriction)).toBe(0)
    expect(restrictionView(restriction)).toEqual({
      kind: 'COOLING',
      until: monthAfter(daysAgo(1)).toISOString(),
    })
  })

  it('без ограничений — прайс как есть, наружу null', () => {
    const restriction = inviteRestriction({ declines: [], openComplaints: 0, now: NOW })

    expect(freeInvitesUnder(3, restriction)).toBe(3)
    expect(restrictionView(restriction)).toBeNull()
  })
})
