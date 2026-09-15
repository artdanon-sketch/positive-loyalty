import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { TAGS_MAX } from '@positive/contracts'
import type { CreateTagInput, Tag, UpdateTagInput } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Справочник тегов заведения. docs/02, раздел 5.2.5 · docs/11, У5.
 *
 * В ОТЛИЧИЕ ОТ ВИДОВ ПРОДАЖ, ТЕГ МОЖНО УДАЛИТЬ. На него не ссылается журнал —
 * это пометка для себя, и удалённый тег просто сходит со всех гостей.
 *
 * НАЗВАНИЕ УНИКАЛЬНО БЕЗ УЧЁТА РЕГИСТРА: «VIP» и «vip» в карточке гостя
 * неотличимы, и два таких тега — верный способ отметить не тот.
 */

export const TAG_SELECT = { id: true, name: true, color: true } as const

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Tag[]> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) =>
      tx.tag.findMany({
        where: { tenantId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: TAG_SELECT,
      }),
    )
  }

  async create(input: CreateTagInput): Promise<Tag> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      if ((await tx.tag.count({ where: { tenantId } })) >= TAGS_MAX) {
        throw new BadRequestException({
          error: {
            code: 'TOO_MANY_TAGS',
            message: `Тегов не может быть больше ${String(TAGS_MAX)}`,
          },
        })
      }

      await this.assertNameFree(tx, tenantId, input.name, null)

      return tx.tag.create({
        data: { tenantId, name: input.name, color: input.color },
        select: TAG_SELECT,
      })
    })
  }

  async update(id: string, input: UpdateTagInput): Promise<Tag> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.tag.findFirst({ where: { id, tenantId }, select: { id: true } })

      if (current === null) {
        // Чужой тег — 404, а не 403: по коду ответа не должно быть видно, что он есть.
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Тег не найден' } })
      }

      if (input.name !== undefined) {
        await this.assertNameFree(tx, tenantId, input.name, id)
      }

      return tx.tag.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.color === undefined ? {} : { color: input.color }),
        },
        select: TAG_SELECT,
      })
    })
  }

  /** Удалённый тег сходит со всех гостей — каскадом внешнего ключа. */
  async remove(id: string): Promise<void> {
    const { tenantId } = TenantContext.getOrThrow()

    const deleted = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tag.deleteMany({ where: { id, tenantId } }),
    )

    if (deleted.count === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Тег не найден' } })
    }
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const duplicate = await tx.tag.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId === null ? {} : { NOT: { id: exceptId } }),
      },
      select: { id: true },
    })

    if (duplicate !== null) {
      throw new ConflictException({
        error: { code: 'TAG_EXISTS', message: 'Тег с таким названием уже есть' },
      })
    }
  }
}
