import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { CHANNELS_MAX, HUMAN_CODE_LENGTH } from '@positive/contracts'
import type { Channel, CreateChannelInput, UpdateChannelInput } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import { isUniqueViolation, randomCode } from '../core/random-code'
import type { Prisma } from '../generated/prisma/client'

/**
 * Справочник источников трафика. docs/02, раздел 5.9 · docs/11, У7.
 *
 * ИСТОЧНИК НЕ УДАЛЯЕТСЯ, А ВЫКЛЮЧАЕТСЯ. На него ссылаются гости, которые по нему
 * пришли, и отчёт за прошлый месяц не должен терять строку, потому что табличку
 * со стола убрали. Выключенный источник не принимает новых гостей.
 *
 * КОД ВЫДАЁТ СЕРВЕР. Владелец придумал бы «TABLE1», а код из ссылки на табличке
 * виден любому — перебирать соседние «TABLE2» незачем давать повод.
 *
 * НАЗВАНИЕ УНИКАЛЬНО БЕЗ УЧЁТА РЕГИСТРА, как у тегов: «Instagram» и «instagram»
 * в отчёте неотличимы.
 */

export const CHANNEL_SELECT = { id: true, name: true, code: true, isActive: true } as const

/** Попыток выдать уникальный код. На алфавите из 31 знака совпадение — редкость. */
const CODE_ATTEMPTS = 5

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Channel[]> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) =>
      tx.acquisitionChannel.findMany({
        where: { tenantId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: CHANNEL_SELECT,
      }),
    )
  }

  async create(input: CreateChannelInput): Promise<Channel> {
    const { tenantId } = TenantContext.getOrThrow()

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.forTenant(tenantId, async (tx) => {
          if ((await tx.acquisitionChannel.count({ where: { tenantId } })) >= CHANNELS_MAX) {
            throw new BadRequestException({
              error: {
                code: 'TOO_MANY_CHANNELS',
                message: `Источников не может быть больше ${String(CHANNELS_MAX)}`,
              },
            })
          }

          await this.assertNameFree(tx, tenantId, input.name, null)

          return tx.acquisitionChannel.create({
            data: { tenantId, name: input.name, code: randomCode(HUMAN_CODE_LENGTH) },
            select: CHANNEL_SELECT,
          })
        })
      } catch (error) {
        // Уникальность в базе одна — код в пределах заведения. Совпал — берём другой.
        if (!isUniqueViolation(error)) {
          throw error
        }
      }
    }

    throw new InternalServerErrorException({
      error: {
        code: 'CHANNEL_CODE_UNAVAILABLE',
        message: 'Не получилось выдать код ссылки — попробуйте ещё раз',
      },
    })
  }

  async update(id: string, input: UpdateChannelInput): Promise<Channel> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.acquisitionChannel.findFirst({
        where: { id, tenantId },
        select: { id: true },
      })

      if (current === null) {
        // Чужой источник — 404, а не 403: по коду ответа не должно быть видно, что он есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Источник не найден' },
        })
      }

      if (input.name !== undefined) {
        await this.assertNameFree(tx, tenantId, input.name, id)
      }

      return tx.acquisitionChannel.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: CHANNEL_SELECT,
      })
    })
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<void> {
    const duplicate = await tx.acquisitionChannel.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId === null ? {} : { NOT: { id: exceptId } }),
      },
      select: { id: true },
    })

    if (duplicate !== null) {
      throw new ConflictException({
        error: { code: 'CHANNEL_EXISTS', message: 'Источник с таким названием уже есть' },
      })
    }
  }
}
