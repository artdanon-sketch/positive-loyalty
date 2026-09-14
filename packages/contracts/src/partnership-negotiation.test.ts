import { describe, expect, it } from 'vitest'

import {
  CreateInviteInput,
  INVITE_TEXT_MIN,
  NetworkVenue,
  PartnershipListQuery,
  PartnershipReasonInput,
} from './partnership.js'

const PARTNER = '22222222-2222-4222-8222-222222222222'
const PITCH = 'Мы студия танцев через дорогу, у нас двести учеников в месяц.'

describe('Приглашение к партнёрству', () => {
  it('принимает приглашение с текстом по существу', () => {
    expect(CreateInviteInput.safeParse({ partnerTenantId: PARTNER, text: PITCH }).success).toBe(
      true,
    )
  })

  it('«привет» — не приглашение: короче сорока знаков отвергается', () => {
    const result = CreateInviteInput.safeParse({ partnerTenantId: PARTNER, text: 'Привет!' })

    expect(result.success).toBe(false)
  })

  it('пробелы по краям не засчитываются в длину', () => {
    const padded = `   ${'а'.repeat(INVITE_TEXT_MIN - 1)}   `

    expect(CreateInviteInput.safeParse({ partnerTenantId: PARTNER, text: padded }).success).toBe(
      false,
    )
  })

  it('от чьего имени приглашать, не выбирают: лишнее поле отвергается', () => {
    const result = CreateInviteInput.safeParse({
      partnerTenantId: PARTNER,
      text: PITCH,
      initiatorTenantId: PARTNER,
    })

    expect(result.success).toBe(false)
  })
})

describe('Витрина заведения', () => {
  const VENUE = {
    tenantId: PARTNER,
    brandName: 'Sabai Thai Massage',
    vertical: 'SPA',
    guestsApprox: 500,
    partnership: null,
  }

  it('пропускает витрину', () => {
    expect(NetworkVenue.safeParse(VENUE).success).toBe(true)
  })

  it('ВЫРУЧКА В ВИТРИНУ НЕ ПРОЛЕЗЕТ — даже если сервер однажды ошибётся', () => {
    expect(NetworkVenue.safeParse({ ...VENUE, revenue: 1_000_000 }).success).toBe(false)
  })
})

describe('Мелочи', () => {
  it('причина необязательна, но пустая строка причиной не считается', () => {
    expect(PartnershipReasonInput.safeParse({}).success).toBe(true)
    expect(PartnershipReasonInput.safeParse({ reason: '   ' }).success).toBe(false)
  })

  it('фильтр списка — только известные статусы', () => {
    expect(PartnershipListQuery.safeParse({ status: 'ACTIVE' }).success).toBe(true)
    expect(PartnershipListQuery.safeParse({ status: 'SECRET' }).success).toBe(false)
  })
})
