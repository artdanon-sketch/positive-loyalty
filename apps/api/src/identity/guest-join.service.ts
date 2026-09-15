import { Injectable, NotFoundException } from '@nestjs/common'
import type { JoinVenueResult } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { isUniqueViolation } from '../core/random-code'
import { currentGuestId } from './current-guest'

/**
 * Вступить в заведение по ссылке источника: табличка на столе, Instagram.
 * docs/02, раздел 2.6 · docs/11, У7.
 *
 * ПЕРВОЕ КАСАНИЕ. Источник пишется только новому гостю заведения. Тот, кто уже
 * ходит сюда и отсканировал табличку, остаётся при своём источнике — иначе отчёт
 * приписал бы табличке постоянных гостей.
 *
 * Как и приглашение друга — тенантным контуром RLS: гостевой контур не даёт писать
 * участия. Заведение из адреса проверяет база: без действующего кода в этом
 * заведении ответа нет.
 */

const CHANNEL_NOT_FOUND = {
  error: {
    code: 'CHANNEL_NOT_FOUND',
    message: 'Ссылка не найдена или больше не действует',
  },
}

@Injectable()
export class GuestJoinService {
  constructor(private readonly prisma: PrismaService) {}

  async join(tenantId: string, code: string): Promise<JoinVenueResult> {
    const guestId = currentGuestId()

    try {
      return await this.attach(tenantId, guestId, code)
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      // Вторая вкладка успела первой — теперь участие есть, и ответ «уже гость».
      return this.attach(tenantId, guestId, code)
    }
  }

  private async attach(tenantId: string, guestId: string, code: string): Promise<JoinVenueResult> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const channel = await tx.acquisitionChannel.findFirst({
        where: { tenantId, code, isActive: true },
        select: { id: true, tenant: { select: { brandName: true } } },
      })

      if (channel === null) {
        throw new NotFoundException(CHANNEL_NOT_FOUND)
      }

      const brandName = channel.tenant.brandName

      const existing = await tx.membership.findFirst({
        where: { tenantId, guestId },
        select: { id: true },
      })

      if (existing !== null) {
        return { tenantId, brandName, joined: false }
      }

      await tx.membership.create({
        data: { guestId, tenantId, source: 'ORGANIC', channelId: channel.id },
      })

      return { tenantId, brandName, joined: true }
    })
  }
}
