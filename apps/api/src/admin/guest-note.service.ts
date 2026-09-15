import { Injectable, NotFoundException } from '@nestjs/common'
import type { GuestNoteResult } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Заметка о госте. docs/02, раздел 5.2.4 · docs/11, У5.
 *
 * ОДНА ЗАМЕТКА, А НЕ ЛЕНТА. «Аллергия на арахис, любит столик у окна» нужно
 * увидеть сразу, открыв карточку, а не пролистывать.
 *
 * Заметка — заведения, а не гостя: в приложение гостя она не уходит, и соседнее
 * заведение её не видит — участие адресуется своим заведением.
 */
@Injectable()
export class GuestNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async set(guestId: string, text: string): Promise<GuestNoteResult> {
    const { tenantId } = TenantContext.getOrThrow()
    const note = text === '' ? null : text

    const updated = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.updateMany({ where: { guestId, tenantId }, data: { note } }),
    )

    if (updated.count === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } })
    }

    return { note }
  }
}
