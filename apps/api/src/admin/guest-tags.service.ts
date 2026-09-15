import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { GuestTagsResult, SetGuestTagsInput } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { TAG_SELECT } from './tags.service'

/**
 * Теги на госте. docs/02, раздел 5.2.5 · docs/11, У5.
 *
 * НАБОРОМ ЦЕЛИКОМ, В ОДНОЙ ТРАНЗАКЦИИ: старые снимаются, отмеченные ставятся.
 * Экран показывает галочки и сохраняет ровно то, что на нём отмечено.
 *
 * ЧУЖОЙ ИЛИ УДАЛЁННЫЙ ТЕГ — ОТКАЗ ЦЕЛИКОМ, а не молча выкинутый: иначе менеджер
 * решил бы, что тег стоит, а его нет.
 */
@Injectable()
export class GuestTagsService {
  constructor(private readonly prisma: PrismaService) {}

  async set(guestId: string, input: SetGuestTagsInput): Promise<GuestTagsResult> {
    const { tenantId } = TenantContext.getOrThrow()

    const tags = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { guestId, tenantId },
        select: { id: true },
      })

      if (membership === null) {
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } })
      }

      const known =
        input.tagIds.length === 0
          ? 0
          : await tx.tag.count({ where: { tenantId, id: { in: input.tagIds } } })

      if (known !== input.tagIds.length) {
        throw new BadRequestException({
          error: {
            code: 'UNKNOWN_TAG',
            message: 'Такого тега нет в заведении — обновите список тегов',
          },
        })
      }

      await tx.guestTag.deleteMany({ where: { tenantId, membershipId: membership.id } })

      if (input.tagIds.length > 0) {
        await tx.guestTag.createMany({
          data: input.tagIds.map((tagId) => ({ tenantId, membershipId: membership.id, tagId })),
        })
      }

      return tx.tag.findMany({
        where: { tenantId, id: { in: input.tagIds } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: TAG_SELECT,
      })
    })

    return { tags }
  }
}
