import { Injectable, NotFoundException } from '@nestjs/common'
import { CATALOG_PAGE } from '@positive/contracts'
import type {
  CatalogItem,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Каталог заведения в бэк-офисе. docs/02, раздел 5.17.
 *
 * УДАЛЕНИЯ НЕТ, ЕСТЬ ВЫКЛЮЧЕНИЕ. Позиция, которую сняли с витрины, остаётся
 * у владельца: по каталогу с исчезнувшими строками нельзя разобрать ни старый
 * заказ, ни спор о том, за сколько баллов гость что-то брал.
 *
 * ПОРЯДОК ЗАДАЁТ ВЛАДЕЛЕЦ. Витрина — это не алфавит: то, ради чего копят,
 * должно стоять сверху.
 */

const SELECT = {
  id: true,
  name: true,
  description: true,
  priceMinor: true,
  pointsPrice: true,
  imageUrl: true,
  isActive: true,
  sortOrder: true,
} as const

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CatalogItem[]> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) =>
      tx.catalogItem.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: CATALOG_PAGE,
        select: SELECT,
      }),
    )
  }

  async create(input: CreateCatalogItemInput): Promise<CatalogItem> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const row = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.catalogItem.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description,
          priceMinor: input.priceMinor,
          pointsPrice: input.pointsPrice,
          imageUrl: input.imageUrl,
          sortOrder: input.sortOrder,
        },
        select: SELECT,
      }),
    )

    await this.audit.write({
      action: 'CATALOG_ITEM_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'CatalogItem',
      entityId: row.id,
      newValue: { name: row.name, pointsPrice: row.pointsPrice },
    })

    return row
  }

  async update(id: string, input: UpdateCatalogItemInput): Promise<CatalogItem> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.catalogItem.findFirst({ where: { id, tenantId }, select: SELECT })

      if (current === null) {
        // Чужая позиция — 404, а не 403: по ответу не должно быть видно, что она есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Позиция не найдена' },
        })
      }

      const row = await tx.catalogItem.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
          ...(input.pointsPrice === undefined ? {} : { pointsPrice: input.pointsPrice }),
          ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        },
        select: SELECT,
      })

      return { before: current, after: row }
    })

    await this.audit.write({
      action: 'CATALOG_ITEM_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'CatalogItem',
      entityId: id,
      oldValue: { name: before.name, pointsPrice: before.pointsPrice, isActive: before.isActive },
      newValue: { name: after.name, pointsPrice: after.pointsPrice, isActive: after.isActive },
    })

    return after
  }
}
