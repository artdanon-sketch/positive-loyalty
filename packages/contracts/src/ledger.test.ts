import { describe, expect, it } from 'vitest'

import {
  EarnInput,
  IdempotencyKey,
  LedgerEntryRecord,
  LedgerOperationResult,
  RedeemInput,
  ReverseInput,
} from './ledger.js'

const MEMBERSHIP_ID = '3f1d5b7a-1c2e-4a6b-9d80-5e2f7c9a1b34'
const ENTRY_ID = '0a9c4d21-77bb-4f0e-8c31-9d5a6b2e4f10'
const ACTOR_ID = 'b21f0c53-4e88-4d1a-9f76-2c0a5e8d3b91'
const LOCATION_ID = 'c7e2a9f4-6b13-4c85-9a20-8d4f1e6b7c03'
const TENANT_ID = 'd4b8e1a7-2f95-4c60-8e13-7a5b9c2d0e46'
const GUEST_ID = 'e58c3f01-9a24-4b7d-8f52-1c6e0a4d7b93'

/** Полный корректный вход начисления — от него отталкиваются негативные случаи. */
const validEarn = {
  membershipId: MEMBERSHIP_ID,
  amount: 12_000,
  idempotencyKey: 'pos_rcpt_99182',
  basisAmount: 120_000,
  currency: 'THB',
  refType: 'receipt',
  refId: 'A-10493',
  source: 'POS_WEBHOOK',
  actorType: 'SYSTEM',
  locationId: LOCATION_ID,
} as const

const validRedeem = {
  membershipId: MEMBERSHIP_ID,
  amount: 20_000,
  idempotencyKey: '8d1f0a2c-6b44-4e19-9c07-3a2d5f8b1e60',
  basisAmount: 120_000,
  source: 'STAFF_MANUAL',
  actorType: 'STAFF',
  actorId: ACTOR_ID,
  locationId: LOCATION_ID,
} as const

const validReverse = {
  entryId: ENTRY_ID,
  idempotencyKey: 'void_pos_rcpt_99182',
  reason: 'RECEIPT_VOIDED',
  source: 'POS_WEBHOOK',
  actorType: 'SYSTEM',
} as const

const validRecord = {
  id: ENTRY_ID,
  tenantId: TENANT_ID,
  guestId: GUEST_ID,
  membershipId: MEMBERSHIP_ID,
  type: 'EARN',
  amount: 12_000,
  balanceAfter: 34_000,
  basisAmount: 120_000,
  currency: 'THB',
  source: 'POS_WEBHOOK',
  refType: 'receipt',
  refId: 'A-10493',
  idempotencyKey: 'pos_rcpt_99182',
  reversalOfId: null,
  offerId: null,
  actorType: 'SYSTEM',
  actorId: null,
  locationId: LOCATION_ID,
  deviceId: null,
  ip: null,
  createdAt: '2026-08-18T12:45:00.000Z',
} as const

/** Пути полей, к которым претензии у валидатора — удобно сравнивать в ожиданиях. */
function issuePaths(schema: { safeParse: (input: unknown) => unknown }, input: unknown): string[] {
  const result = schema.safeParse(input) as
    { success: true } | { success: false; error: { issues: { path: PropertyKey[] }[] } }

  if (result.success) {
    return []
  }

  return result.error.issues.map((issue) => issue.path.join('.'))
}

/** Есть ли среди претензий отказ по лишнему ключу — это и есть проверка .strict(). */
function hasUnrecognizedKeys(
  schema: { safeParse: (input: unknown) => unknown },
  input: unknown,
): boolean {
  const result = schema.safeParse(input) as
    { success: true } | { success: false; error: { issues: { code: string }[] } }

  return !result.success && result.error.issues.some((issue) => issue.code === 'unrecognized_keys')
}

describe('IdempotencyKey', () => {
  it('принимает ключ вебхука, nonce и UUID', () => {
    expect(IdempotencyKey.parse('pos_rcpt_99182')).toBe('pos_rcpt_99182')
    expect(IdempotencyKey.parse('8d1f0a2c-6b44-4e19-9c07-3a2d5f8b1e60')).toHaveLength(36)
  })

  it('отклоняет пустой ключ и ключ из одних пробелов', () => {
    expect(IdempotencyKey.safeParse('').success).toBe(false)
    expect(IdempotencyKey.safeParse('   ').success).toBe(false)
  })

  it('отклоняет ключ длиннее разумного предела', () => {
    expect(IdempotencyKey.safeParse('k'.repeat(129)).success).toBe(false)
  })
})

describe('EarnInput', () => {
  it('разбирает корректное начисление по вебхуку кассы', () => {
    const parsed = EarnInput.parse(validEarn)

    expect(parsed.membershipId).toBe(MEMBERSHIP_ID)
    expect(parsed.amount).toBe(12_000)
    expect(parsed.refType).toBe('receipt')
  })

  it('принимает минимальный вход: без чека, без ссылки, без точки', () => {
    const parsed = EarnInput.parse({
      membershipId: MEMBERSHIP_ID,
      amount: 500,
      idempotencyKey: 'welcome_bonus_1',
      source: 'SYSTEM',
      actorType: 'SYSTEM',
    })

    expect(parsed.basisAmount).toBeUndefined()
    expect(parsed.currency).toBeUndefined()
  })

  it('принимает нулевое начисление — визит гостя из контрольной группы', () => {
    expect(EarnInput.safeParse({ ...validEarn, amount: 0 }).success).toBe(true)
  })

  it('отклоняет лишнее поле — это и проверяет .strict()', () => {
    expect(hasUnrecognizedKeys(EarnInput, { ...validEarn, tenantId: TENANT_ID })).toBe(true)
    expect(hasUnrecognizedKeys(EarnInput, { ...validEarn, balanceAfter: 999 })).toBe(true)
  })

  it('отклоняет дробную сумму баллов и дробную сумму чека', () => {
    expect(issuePaths(EarnInput, { ...validEarn, amount: 12_000.5 })).toContain('amount')
    expect(issuePaths(EarnInput, { ...validEarn, basisAmount: 0.1 })).toContain('basisAmount')
  })

  it('отклоняет отрицательное начисление — это списание, ему место в redeem', () => {
    expect(issuePaths(EarnInput, { ...validEarn, amount: -200 })).toContain('amount')
    expect(issuePaths(EarnInput, { ...validEarn, basisAmount: -1 })).toContain('basisAmount')
  })

  it('отклоняет сумму, не влезающую в int4', () => {
    expect(issuePaths(EarnInput, { ...validEarn, amount: 2_147_483_648 })).toContain('amount')
  })

  it('отклоняет пустой ключ идемпотентности', () => {
    expect(issuePaths(EarnInput, { ...validEarn, idempotencyKey: '' })).toContain('idempotencyKey')
    expect(issuePaths(EarnInput, { ...validEarn, idempotencyKey: ' ' })).toContain('idempotencyKey')
  })

  it('отклоняет пропущенный ключ идемпотентности', () => {
    const { idempotencyKey: _dropped, ...withoutKey } = validEarn

    expect(issuePaths(EarnInput, withoutKey)).toContain('idempotencyKey')
  })

  it('отклоняет неизвестный источник, тип актора и тип ссылки', () => {
    expect(issuePaths(EarnInput, { ...validEarn, source: 'TELEPATHY' })).toContain('source')
    expect(issuePaths(EarnInput, { ...validEarn, actorType: 'ROBOT' })).toContain('actorType')
    expect(issuePaths(EarnInput, { ...validEarn, refType: 'reciept' })).toContain('refType')
  })

  it('отклоняет половину ссылки: refType и refId ходят парой', () => {
    const { refId: _noId, ...withoutRefId } = validEarn
    const { refType: _noType, ...withoutRefType } = validEarn

    expect(issuePaths(EarnInput, withoutRefId)).toContain('refId')
    expect(issuePaths(EarnInput, withoutRefType)).toContain('refId')
  })

  it('отклоняет membershipId, который не UUID', () => {
    expect(issuePaths(EarnInput, { ...validEarn, membershipId: 'm_42' })).toContain('membershipId')
  })

  it('отклоняет валюту не в формате ISO-4217', () => {
    expect(issuePaths(EarnInput, { ...validEarn, currency: 'thb' })).toContain('currency')
    expect(issuePaths(EarnInput, { ...validEarn, currency: 'BAHT' })).toContain('currency')
  })

  it('отклоняет невалидный ip', () => {
    expect(EarnInput.safeParse({ ...validEarn, ip: '203.0.113.7' }).success).toBe(true)
    expect(issuePaths(EarnInput, { ...validEarn, ip: '999.1.1.1' })).toContain('ip')
  })
})

describe('RedeemInput', () => {
  it('разбирает корректное списание', () => {
    const parsed = RedeemInput.parse(validRedeem)

    expect(parsed.amount).toBe(20_000)
    expect(parsed.actorType).toBe('STAFF')
  })

  it('отклоняет лишнее поле', () => {
    expect(hasUnrecognizedKeys(RedeemInput, { ...validRedeem, type: 'REDEEM' })).toBe(true)
  })

  it('отклоняет дробную сумму списания', () => {
    expect(issuePaths(RedeemInput, { ...validRedeem, amount: 199.99 })).toContain('amount')
  })

  it('отклоняет отрицательную сумму: знак ставит сервис, а не вызывающий', () => {
    expect(issuePaths(RedeemInput, { ...validRedeem, amount: -20_000 })).toContain('amount')
  })

  it('отклоняет списание нуля баллов — операция без эффекта', () => {
    expect(issuePaths(RedeemInput, { ...validRedeem, amount: 0 })).toContain('amount')
  })

  it('отклоняет пустой ключ идемпотентности', () => {
    expect(issuePaths(RedeemInput, { ...validRedeem, idempotencyKey: '' })).toContain(
      'idempotencyKey',
    )
  })
})

describe('ReverseInput', () => {
  it('разбирает отмену по аннулированному чеку', () => {
    const parsed = ReverseInput.parse(validReverse)

    expect(parsed.entryId).toBe(ENTRY_ID)
    expect(parsed.reason).toBe('RECEIPT_VOIDED')
  })

  it('не принимает сумму: она берётся из компенсируемой записи', () => {
    expect(hasUnrecognizedKeys(ReverseInput, { ...validReverse, amount: 12_000 })).toBe(true)
  })

  it('отклоняет лишнее поле', () => {
    expect(hasUnrecognizedKeys(ReverseInput, { ...validReverse, reversalOfId: ENTRY_ID })).toBe(
      true,
    )
  })

  it('требует комментарий при причине OTHER', () => {
    expect(issuePaths(ReverseInput, { ...validReverse, reason: 'OTHER' })).toContain('comment')
    expect(
      ReverseInput.safeParse({ ...validReverse, reason: 'OTHER', comment: 'разбор с менеджером' })
        .success,
    ).toBe(true)
  })

  it('отклоняет пустой комментарий и неизвестную причину', () => {
    expect(issuePaths(ReverseInput, { ...validReverse, comment: '   ' })).toContain('comment')
    expect(issuePaths(ReverseInput, { ...validReverse, reason: 'JUST_BECAUSE' })).toContain(
      'reason',
    )
  })

  it('отклоняет пустой ключ идемпотентности и не-UUID в entryId', () => {
    expect(issuePaths(ReverseInput, { ...validReverse, idempotencyKey: '' })).toContain(
      'idempotencyKey',
    )
    expect(issuePaths(ReverseInput, { ...validReverse, entryId: 'entry-1' })).toContain('entryId')
  })
})

describe('LedgerEntryRecord', () => {
  it('разбирает запись начисления', () => {
    expect(LedgerEntryRecord.parse(validRecord)).toEqual(validRecord)
  })

  it('принимает отрицательный amount — в журнале он знаковый', () => {
    const redeemed = { ...validRecord, type: 'REDEEM', amount: -20_000, balanceAfter: 14_000 }

    expect(LedgerEntryRecord.parse(redeemed).amount).toBe(-20_000)
  })

  it('отклоняет отрицательный balanceAfter — баланс в минус не уходит', () => {
    expect(issuePaths(LedgerEntryRecord, { ...validRecord, balanceAfter: -1 })).toContain(
      'balanceAfter',
    )
  })

  it('отклоняет дробный amount и дробный balanceAfter', () => {
    expect(issuePaths(LedgerEntryRecord, { ...validRecord, amount: 1.5 })).toContain('amount')
    expect(issuePaths(LedgerEntryRecord, { ...validRecord, balanceAfter: 1.5 })).toContain(
      'balanceAfter',
    )
  })

  it('различает null и отсутствие ключа: из базы приходит null', () => {
    const { offerId: _dropped, ...withoutOfferId } = validRecord

    expect(issuePaths(LedgerEntryRecord, withoutOfferId)).toContain('offerId')
    expect(LedgerEntryRecord.safeParse({ ...validRecord, offerId: null }).success).toBe(true)
  })

  it('отклоняет createdAt не в ISO-8601', () => {
    expect(issuePaths(LedgerEntryRecord, { ...validRecord, createdAt: '18.08.2026' })).toContain(
      'createdAt',
    )
  })

  it('отклоняет лишнее поле', () => {
    expect(hasUnrecognizedKeys(LedgerEntryRecord, { ...validRecord, secret: 'x' })).toBe(true)
  })
})

describe('LedgerOperationResult', () => {
  it('разбирает результат первой операции и результат повтора', () => {
    expect(LedgerOperationResult.parse({ entry: validRecord, replayed: false }).replayed).toBe(
      false,
    )
    expect(LedgerOperationResult.parse({ entry: validRecord, replayed: true }).replayed).toBe(true)
  })

  it('требует флаг повтора: без него вызывающий не отличит вторую операцию от первой', () => {
    expect(issuePaths(LedgerOperationResult, { entry: validRecord })).toContain('replayed')
  })

  it('отклоняет лишнее поле', () => {
    expect(
      hasUnrecognizedKeys(LedgerOperationResult, {
        entry: validRecord,
        replayed: false,
        balance: 34_000,
      }),
    ).toBe(true)
  })
})
