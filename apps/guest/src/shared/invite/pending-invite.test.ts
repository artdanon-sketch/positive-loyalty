import { beforeEach, describe, expect, it } from 'vitest'

import { captureInvite, clearInvite, readInvite } from './pending-invite'

const VENUE = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('Ссылка в заведение, открытая до входа', () => {
  it('КОД ИЗ АДРЕСА ЗАПОМИНАЕТСЯ ДО ВХОДА, А АДРЕС ОЧИЩАЕТСЯ — ОСТАЛЬНОЕ В НЁМ ОСТАЁТСЯ', () => {
    window.history.replaceState(null, '', `/?lang=th&venue=${VENUE}&ref=7kq2mx4p#top`)

    captureInvite()

    expect(readInvite()).toEqual({ kind: 'referral', tenantId: VENUE, code: '7KQ2MX4P' })
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/?lang=th#top',
    )
  })

  it('ССЫЛКА ТАБЛИЧКИ — ЭТО ИСТОЧНИК, А ЕСЛИ В ССЫЛКЕ ЕСТЬ И ДРУГ, ТО ПРИГЛАШЕНИЕ', () => {
    window.history.replaceState(null, '', `/?venue=${VENUE}&src=tbr2k7qx`)
    captureInvite()
    expect(readInvite()).toEqual({ kind: 'channel', tenantId: VENUE, code: 'TBR2K7QX' })
    expect(window.location.search).toBe('')

    window.history.replaceState(null, '', `/?venue=${VENUE}&src=TBR2K7QX&ref=7KQ2MX4P`)
    captureInvite()
    expect(readInvite()).toEqual({ kind: 'referral', tenantId: VENUE, code: '7KQ2MX4P' })
    expect(window.location.search).toBe('')
  })

  it('битая ссылка не запоминается, но из адреса всё равно убирается', () => {
    window.history.replaceState(null, '', '/?venue=kata&ref=IO01')

    captureInvite()

    expect(readInvite()).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('без ссылки в адресе запомненное не стирается, а адрес не трогается', () => {
    window.localStorage.setItem(
      'positive.guest.invite',
      JSON.stringify({ kind: 'channel', tenantId: VENUE, code: 'TBR2K7QX' }),
    )
    window.history.replaceState(null, '', '/?lang=th')

    captureInvite()

    expect(window.location.search).toBe('?lang=th')
    expect(readInvite()).toEqual({ kind: 'channel', tenantId: VENUE, code: 'TBR2K7QX' })

    clearInvite()
    expect(readInvite()).toBeNull()
  })

  it('запомненное до появления источников читается как приглашение друга, мусор — не читается', () => {
    window.localStorage.setItem(
      'positive.guest.invite',
      JSON.stringify({ tenantId: VENUE, code: '7KQ2MX4P' }),
    )
    expect(readInvite()).toEqual({ kind: 'referral', tenantId: VENUE, code: '7KQ2MX4P' })

    window.localStorage.setItem('positive.guest.invite', '{"tenantId":"x"')
    expect(readInvite()).toBeNull()

    window.localStorage.setItem('positive.guest.invite', JSON.stringify({ tenantId: VENUE }))
    expect(readInvite()).toBeNull()
  })
})
