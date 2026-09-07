import { Injectable, NotFoundException } from '@nestjs/common'
import type { GuestMe, GuestQrToken, GuestWallet } from '@positive/contracts'

import { getEnv } from '../common/config/env'
import { maskPhone } from '../common/pii/mask-phone'
import { signGuestQrToken } from '../common/tenant/access-token'
import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/** Токен на кассу живёт пять минут: экран открыт у стойки, а не хранится. */
const QR_TTL_SECONDS = 300

@Injectable()
export class GuestService {
  constructor(private readonly prisma: PrismaService) {}

  private guestId(): string {
    const guestId = TenantContext.getOrThrow().guestId
    if (guestId === null) {
      // Недостижимо за GuestGuard; страховка от вызова мимо него.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }
    return guestId
  }

  async me(): Promise<GuestMe> {
    const guestId = this.guestId()

    const guest = await this.prisma.forGuest(guestId, async (tx) =>
      tx.guest.findFirst({ where: { id: guestId } }),
    )

    if (guest === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    return {
      id: guest.id,
      displayName: guest.displayName,
      mode: guest.mode,
      locale: guest.locale,
      phoneMasked: maskPhone(guest.phoneE164),
    }
  }

  /**
   * Кошелёк — участия во всех заведениях. Гостевой контур RLS отдаёт ровно
   * свои строки: и участия, и витрины заведений (миграция 20260826230000).
   * Никакого перебора тенантов в коде: изоляцию держит база.
   */
  async wallet(): Promise<GuestWallet> {
    const guestId = this.guestId()

    const rows = await this.prisma.forGuest(guestId, async (tx) =>
      tx.membership.findMany({
        where: { guestId },
        include: { tenant: { select: { brandName: true } } },
        orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      }),
    )

    const memberships = rows.map((row) => ({
      tenantId: row.tenantId,
      brandName: row.tenant.brandName,
      points: row.pointsBalance,
      visitsTotal: row.visitsTotal,
      lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
      isControlGroup: row.isControlGroup,
    }))

    return {
      totalPoints: memberships.reduce((sum, membership) => sum + membership.points, 0),
      memberships,
    }
  }

  // Не async: подпись токена синхронная, а пустой async обещает ожидание,
  // которого нет. Promise в сигнатуре контроллера это не ломает.
  qrToken(): GuestQrToken {
    const guestId = this.guestId()

    return {
      token: signGuestQrToken({ guestId }, getEnv().accessTokenSecret, QR_TTL_SECONDS),
      expiresIn: QR_TTL_SECONDS,
    }
  }
}
