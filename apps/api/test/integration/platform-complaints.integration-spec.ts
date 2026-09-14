/**
 * Разбор жалоб на спам в приглашениях — со стороны платформы. docs/07, раздел 6.2.
 *
 * ─── Почему под ролью positive_platform ──────────────────────────────────────
 *
 * Панель видит то, чего не видит никто из заведений: кто пожаловался и почему.
 * Прогон под владельцем базы обошёл бы права и RLS и не заметил бы, что роли
 * платформы не выдали SELECT на журнал или UPDATE для отметки «разобрано».
 * Данные готовит владелец: заводить заведения платформе не положено.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AuditService } from '../../src/core/audit.service'
import { PlatformComplaintsService } from '../../src/platform/platform-complaints.service'
import { PlatformPrismaService } from '../../src/platform/platform-prisma.service'

import {
  createLedgerTestContext,
  createTenant,
  type LedgerTestContext,
} from './ledger-test-context'

const platformUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_PLATFORM_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_PLATFORM_ROLE. Без него разбор жалоб не проверяется: ' +
      'под владельцем базы права роли платформы не участвуют вовсе.',
  )
}

interface Venue {
  id: string
  brandName: string
}

let owner: LedgerTestContext
let platform: PlatformPrismaService
let service: PlatformComplaintsService

const venue = async (name: string): Promise<Venue> => {
  const id = await createTenant(owner.prisma)
  const brandName = `${name} ${id.slice(0, 6)}`
  await owner.prisma.tenant.update({ where: { id }, data: { brandName } })
  return { id, brandName }
}

/** Жалоба так, как её оставляет блокировка входящего приглашения с `spam`. */
const complain = async (
  from: Venue,
  against: Venue,
  reason: string | null,
  reviewed: { reviewedAt: Date; reviewedBy: string } | null = null,
): Promise<void> => {
  const partnership = await owner.prisma.partnership.create({
    data: {
      initiatorTenantId: against.id,
      partnerTenantId: from.id,
      status: 'DECLINED',
      declinedAt: new Date(),
    },
    select: { id: true },
  })

  await owner.prisma.inviteBlock.create({
    data: { blockerTenantId: from.id, blockedTenantId: against.id, reason },
  })

  await owner.prisma.inviteStrike.createMany({
    data: [
      {
        kind: 'DECLINED',
        fromTenantId: from.id,
        againstTenantId: against.id,
        partnershipId: partnership.id,
      },
      {
        kind: 'SPAM',
        fromTenantId: from.id,
        againstTenantId: against.id,
        partnershipId: partnership.id,
        ...(reviewed ?? {}),
      },
    ],
  })
}

const rowOf = async (tenantId: string) =>
  (await service.open()).items.find((item) => item.tenantId === tenantId)

beforeAll(async () => {
  owner = await createLedgerTestContext()

  const previousUrl = process.env['DATABASE_URL_PLATFORM']
  process.env['DATABASE_URL_PLATFORM'] = platformUrl()

  try {
    platform = new PlatformPrismaService()
    await platform.onModuleInit()
    service = new PlatformComplaintsService(platform, new AuditService(platform))
  } finally {
    if (previousUrl === undefined) {
      delete process.env['DATABASE_URL_PLATFORM']
    } else {
      process.env['DATABASE_URL_PLATFORM'] = previousUrl
    }
  }
}, 60_000)

afterAll(async () => {
  await platform?.$disconnect()
  await owner?.close()
})

describe('Разбор жалоб на спам', () => {
  it('ПАНЕЛЬ ВИДИТ НЕРАЗОБРАННЫЕ ЖАЛОБЫ С ИМЕНАМИ И ПРИЧИНАМИ; РАЗОБРАННЫЕ И ОТКАЗЫ — НЕТ', async () => {
    const accused = await venue('Спамер')
    const first = await venue('Ресторан')
    const second = await venue('Спа')
    const old = await venue('Прокат')

    await complain(first, accused, 'Рассылка всем подряд')
    await complain(second, accused, null)
    await complain(old, accused, 'Давно разобрали', {
      reviewedAt: new Date(),
      reviewedBy: randomUUID(),
    })

    const row = await rowOf(accused.id)

    expect(row).toMatchObject({
      brandName: accused.brandName,
      openComplaints: 2,
      suspended: false,
    })
    expect(row?.complaints).toHaveLength(2)
    expect(row?.complaints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromTenantId: first.id,
          fromBrandName: first.brandName,
          reason: 'Рассылка всем подряд',
        }),
        expect.objectContaining({
          fromTenantId: second.id,
          fromBrandName: second.brandName,
          reason: null,
        }),
      ]),
    )
  })

  it('ПЯТЬ ЖАЛОБ — «ПРИОСТАНОВЛЕНО»; РАЗБОР СНИМАЕТ ЖАЛОБЫ И ОСТАВЛЯЕТ ОДИН СЛЕД', async () => {
    const accused = await venue('Спамер')

    for (let index = 0; index < 5; index += 1) {
      await complain(await venue(`Жертва ${String(index)}`), accused, null)
    }

    expect(await rowOf(accused.id)).toMatchObject({ openComplaints: 5, suspended: true })

    const adminId = randomUUID()
    expect(await service.review(accused.id, adminId, new Date())).toEqual({
      tenantId: accused.id,
      reviewed: 5,
    })

    expect(await rowOf(accused.id)).toBeUndefined()
    expect(
      await owner.prisma.inviteStrike.count({
        where: { againstTenantId: accused.id, kind: 'SPAM', reviewedBy: adminId },
      }),
    ).toBe(5)
    // Отказы разбор не трогает: охлаждение за них — отдельное правило.
    expect(
      await owner.prisma.inviteStrike.count({
        where: { againstTenantId: accused.id, kind: 'DECLINED', reviewedAt: { not: null } },
      }),
    ).toBe(0)

    const trail = await owner.prisma.auditLog.findMany({
      where: { action: 'INVITE_COMPLAINTS_REVIEWED', entityId: accused.id },
      select: { actorType: true, actorId: true, tenantId: true, newValue: true },
    })
    expect(trail).toEqual([
      {
        actorType: 'PLATFORM_ADMIN',
        actorId: adminId,
        tenantId: accused.id,
        newValue: { reviewed: 5 },
      },
    ])

    // Повторное нажатие: разбирать нечего, второго следа нет.
    expect(await service.review(accused.id, adminId, new Date())).toEqual({
      tenantId: accused.id,
      reviewed: 0,
    })
    expect(
      await owner.prisma.auditLog.count({
        where: { action: 'INVITE_COMPLAINTS_REVIEWED', entityId: accused.id },
      }),
    ).toBe(1)
  })
})
