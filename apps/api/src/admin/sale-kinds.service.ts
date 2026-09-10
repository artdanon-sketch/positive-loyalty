import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CreateSaleKindInput, SaleKind, UpdateSaleKindInput } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

/**
 * Виды продаж заведения: что именно оно продаёт гостю.
 *
 * Справочник ведёт САМО ЗАВЕДЕНИЕ. У студии танцев это «абонемент на 10 занятий»
 * и «разовое занятие», у проката — «сутки» и «неделя». Общий список на всех
 * означал бы, что каждый новый вид бизнеса ждёт нашего релиза, чтобы начать
 * работать.
 *
 * УДАЛЕНИЯ НЕТ И НЕ БУДЕТ. Вид, на который ссылается журнал, исчезнуть не может:
 * иначе по журналу нельзя разобрать ни отчёт, ни спор с гостем — операция
 * ссылалась бы в пустоту. Ненужное выключается через `isActive`: кассиру
 * не предлагается, в истории остаётся.
 */

/** Сколько видов продаж разумно вести одному заведению. */
const MAX_KINDS_PER_TENANT = 100

const view = (row: {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}): SaleKind => ({
  id: row.id,
  name: row.name,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
})

@Injectable()
export class SaleKindsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Список видов заведения.
   *
   * Выключенные отдаются тоже: бэк-офис должен показывать их, чтобы владелец
   * мог включить обратно. Отсеивает выключенные тот, кто показывает список
   * кассиру, — там выбор из истории был бы ошибкой.
   */
  async list(tenantId: string): Promise<SaleKind[]> {
    const rows = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.saleKind.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sortOrder: true, isActive: true },
      }),
    )

    return rows.map(view)
  }

  async create(tenantId: string, input: CreateSaleKindInput): Promise<SaleKind> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const existing = await tx.saleKind.count({ where: { tenantId } })

      if (existing >= MAX_KINDS_PER_TENANT) {
        throw new BadRequestException({
          error: {
            code: 'TOO_MANY_SALE_KINDS',
            message: `Видов продаж не может быть больше ${MAX_KINDS_PER_TENANT}`,
          },
        })
      }

      // Одноимённый вид уже есть — сообщаем об этом, а не отдаём 500 от UNIQUE.
      // Два «Абонемента» в списке у кассира — верный способ выбрать не тот.
      const duplicate = await tx.saleKind.findFirst({
        where: { tenantId, name: input.name },
        select: { id: true },
      })

      if (duplicate !== null) {
        throw new BadRequestException({
          error: { code: 'SALE_KIND_EXISTS', message: 'Вид продажи с таким названием уже есть' },
        })
      }

      const row = await tx.saleKind.create({
        data: { tenantId, name: input.name, sortOrder: input.sortOrder },
        select: { id: true, name: true, sortOrder: true, isActive: true },
      })

      return view(row)
    })
  }

  async update(tenantId: string, id: string, input: UpdateSaleKindInput): Promise<SaleKind> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.saleKind.findFirst({
        where: { id, tenantId },
        select: { id: true },
      })

      if (current === null) {
        // Чужой вид — 404, а не 403: по коду ответа не должно быть видно,
        // существует объект или нет (docs/02, раздел 0).
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Вид продажи не найден' },
        })
      }

      if (input.name !== undefined) {
        const duplicate = await tx.saleKind.findFirst({
          where: { tenantId, name: input.name, NOT: { id } },
          select: { id: true },
        })

        if (duplicate !== null) {
          throw new BadRequestException({
            error: { code: 'SALE_KIND_EXISTS', message: 'Вид продажи с таким названием уже есть' },
          })
        }
      }

      const row = await tx.saleKind.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: { id: true, name: true, sortOrder: true, isActive: true },
      })

      return view(row)
    })
  }
}
