import { Injectable } from '@nestjs/common'
import { POS_QUEUE_LATE_AFTER_MINUTES, POS_QUEUE_MAX_ATTEMPTS } from '@positive/contracts'
import type { StuckReceiptList } from '@positive/contracts'

import { maskPhone } from '../common/pii/mask-phone'
import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Чеки, которые не дошли с планшетов. docs/10, раздел 5.7.
 *
 * Показываются два случая, и оба — гость без баллов:
 *   застрял — попытки исчерпаны или сервер отказал; сам он не уйдёт никогда;
 *   опаздывает — лежит дольше часа; уйдёт, когда планшет поймает связь.
 *
 * Свежий чек, пролежавший пять минут, не показывается: на острове связь
 * моргает постоянно, и список из таких чеков приучил бы владельца его не читать.
 */

/** Больше сотни застрявших за раз владелец всё равно не разберёт — это поломка. */
const LIST_LIMIT = 100

/**
 * Какие чеки владелец видит как «не дошли». Одно условие на список и на совет
 * «Обзора»: разойдись они — совет обещал бы три чека, а список показывал два.
 */
export const stuckReceiptsWhere = (tenantId: string, now: Date): Prisma.PosQueueItemWhereInput => ({
  tenantId,
  clearedAt: null,
  OR: [
    { attempts: { gte: POS_QUEUE_MAX_ATTEMPTS } },
    { queuedAt: { lte: new Date(now.getTime() - POS_QUEUE_LATE_AFTER_MINUTES * 60 * 1000) } },
  ],
})

@Injectable()
export class StuckReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<StuckReceiptList> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.posQueueItem.findMany({
        where: stuckReceiptsWhere(tenantId, new Date()),
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      })

      const membershipIds = [
        ...new Set(rows.flatMap((row) => (row.membershipId === null ? [] : [row.membershipId]))),
      ]
      const staffIds = [
        ...new Set(rows.flatMap((row) => (row.staffId === null ? [] : [row.staffId]))),
      ]

      // Участие ищется в СВОЁМ заведении: идентификатор пришёл с планшета,
      // и чужой, даже подсунутый, здесь просто не найдётся.
      const [memberships, staff] = await Promise.all([
        membershipIds.length === 0
          ? Promise.resolve([])
          : tx.membership.findMany({
              where: { tenantId, id: { in: membershipIds } },
              select: { id: true, guest: { select: { displayName: true, phoneE164: true } } },
            }),
        staffIds.length === 0
          ? Promise.resolve([])
          : tx.staff.findMany({
              where: { tenantId, id: { in: staffIds } },
              select: { id: true, displayName: true },
            }),
      ])

      const guests = new Map(
        memberships.map((membership) => [
          membership.id,
          membership.guest.displayName ?? maskPhone(membership.guest.phoneE164),
        ]),
      )
      const names = new Map(staff.map((person) => [person.id, person.displayName]))

      return {
        items: rows.map((row) => ({
          receiptId: row.receiptId,
          amount: row.amount,
          receiptNumber: row.receiptNumber,
          guest:
            (row.membershipId === null ? null : (guests.get(row.membershipId) ?? null)) ??
            row.guestHint,
          staffName: row.staffId === null ? null : (names.get(row.staffId) ?? null),
          terminal: row.terminalId.slice(-4),
          attempts: row.attempts,
          stuck: row.attempts >= POS_QUEUE_MAX_ATTEMPTS,
          lastError: row.lastError,
          queuedAt: row.queuedAt.toISOString(),
          reportedAt: row.reportedAt.toISOString(),
        })),
      }
    })
  }
}
