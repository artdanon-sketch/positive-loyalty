import { beforeEach, describe, expect, it } from 'vitest'

import { captureInvite, clearInvite, readInvite } from './pending-invite'

const VENUE = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('Приглашение из ссылки', () => {
  it('КОД ИЗ АДРЕСА ЗАПОМИНАЕТСЯ ДО ВХОДА, А АДРЕС ОЧИЩАЕТСЯ — ОСТАЛЬНОЕ В НЁМ ОСТАЁТСЯ', () => {
    window.history.replaceState(null, '', `/?lang=th&venue=${VENUE}&ref=7kq2mx4p#top`)

    captureInvite()

    expect(readInvite()).toEqual({ tenantId: VENUE, code: '7KQ2MX4P' })
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/?lang=th#top',
    )
  })

  it('битая ссылка не запоминается, но из адреса всё равно убирается', () => {
    window.history.replaceState(null, '', '/?venue=kata&ref=IO01')

    captureInvite()

    expect(readInvite()).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('без приглашения в адресе запомненное не стирается, а адрес не трогается', () => {
    window.localStorage.setItem(
      'positive.guest.invite',
      JSON.stringify({ tenantId: VENUE, code: '7KQ2MX4P' }),
    )
    window.history.replaceState(null, '', '/?lang=th')

    captureInvite()

    expect(window.location.search).toBe('?lang=th')
    expect(readInvite()).toEqual({ tenantId: VENUE, code: '7KQ2MX4P' })

    clearInvite()
    expect(readInvite()).toBeNull()
  })

  it('мусор в хранилище — не приглашение', () => {
    window.localStorage.setItem('positive.guest.invite', '{"tenantId":"x"')
    expect(readInvite()).toBeNull()

    window.localStorage.setItem('positive.guest.invite', JSON.stringify({ tenantId: VENUE }))
    expect(readInvite()).toBeNull()
  })
})
