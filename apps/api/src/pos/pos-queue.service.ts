import { Injectable } from '@nestjs/common'
import type { PosQueueReport, PosQueueReportResult } from '@positive/contracts'

import { maskPhone } from '../common/pii/mask-phone'
import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Снимок очереди отложенных чеков планшета. docs/02, раздел 3.6.
 *
 * Планшет присылает всё, что у него лежит, — целиком, а не изменения.
 * Целый снимок проще и надёжнее: чек, ушедший из очереди между двумя
 * отчётами, просто не приходит в следующем и помечается снятым. Искать,
 * какой отчёт потерялся по дороге, не нужно.
 *
 * СЕРВЕР ПО СНИМКУ НИЧЕГО НЕ ПРОВОДИТ. Проведёт планшет — тем же ключом
 * идемпотентности, когда появится связь. Здесь только наблюдение для владельца.
 *
 * ТЕЛЕФОН — ТОЛЬКО МАСКОЙ. Если гостя искали по номеру, планшет присылает
 * номер как есть (у него другого нет), а сервер хранит лишь «+66 •• •• 4821».
 */
@Injectable()
export class PosQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async report(input: PosQueueReport): Promise<PosQueueReportResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()
    const now = new Date()
    const receiptIds = input.items.map((item) => item.receiptId)

    await this.prisma.forTenant(tenantId, async (tx) => {
      // Всё, чего нет в новом снимке этого планшета, из его очереди ушло:
      // доехало до сервера или снято. Не удаляем — помечаем.
      await tx.posQueueItem.updateMany({
        where: {
          tenantId,
          terminalId: input.terminalId,
          clearedAt: null,
          ...(receiptIds.length === 0 ? {} : { receiptId: { notIn: receiptIds } }),
        },
        data: { clearedAt: now },
      })

      for (const item of input.items) {
        const data = {
          terminalId: input.terminalId,
          staffId: actorId,
          amount: item.amount,
          receiptNumber: item.receiptNumber ?? null,
          membershipId: item.target.kind === 'MEMBERSHIP' ? item.target.membershipId : null,
          guestHint: item.target.kind === 'PHONE' ? maskPhone(item.target.phone) : null,
          attempts: item.attempts,
          lastError: item.lastError ?? null,
          queuedAt: new Date(item.queuedAt),
          reportedAt: now,
          clearedAt: null,
        }

        await tx.posQueueItem.upsert({
          where: { tenantId_receiptId: { tenantId, receiptId: item.receiptId } },
          create: { tenantId, receiptId: item.receiptId, ...data },
          update: data,
        })
      }
    })

    return { tracked: input.items.length }
  }
}
