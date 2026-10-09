import { Injectable } from '@nestjs/common'
import type { AdminGuestFilters, GuestBirthdayWindow } from '@positive/contracts'

import { localDay } from '../common/time/local-day'
import { birthdayInWindow } from '../core/birthday'
import type { Prisma } from '../generated/prisma/client'
import { guestFilterWhere } from './guest-search'
import { ReportsService } from './reports.service'

/**
 * Кого выбрали фильтры: общая сборка условия для списка гостей и для рассылки.
 * docs/02, разделы 5.2 и 5.4.
 *
 * ОДИН ЯЗЫК СЕГМЕНТОВ НА ВЕСЬ БЭК-ОФИС. Владелец выбирает «спящих резидентов
 * со статусом Золото» одинаково в списке и в рассылке; два разных набора фильтров
 * означали бы, что показанное число и отправленное число расходятся без причины.
 *
 * RFM-СЕГМЕНТ СЧИТАЕТСЯ НА ЛЕТУ (reports.service.ts), в базе его нет, — поэтому
 * условие собирается внутри транзакции, а не строится чистой функцией.
 *
 * ДЕНЬ РОЖДЕНИЯ — ТОЖЕ НА ЛЕТУ: «на этой неделе» зависит от сегодняшнего дня
 * в часах заведения, перехода через Новый год и 29 февраля, а сравнение месяца
 * и дня запросом Prisma не выразить. Правила — те же, что у подарка ко дню
 * рождения (core/birthday.ts): гость, получивший подарок, есть и в фильтре.
 */
@Injectable()
export class GuestAudienceService {
  constructor(private readonly reports: ReportsService) {}

  async where(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filters: AdminGuestFilters,
    now: Date = new Date(),
  ): Promise<Prisma.MembershipWhereInput> {
    const parts: Prisma.MembershipWhereInput[] = [
      { tenantId, ...guestFilterWhere(tenantId, filters, now) },
    ]

    if (filters.segment !== undefined) {
      parts.push({ id: { in: await this.reports.membershipIdsIn(tx, tenantId, filters.segment) } })
    }

    if (filters.birthday !== undefined) {
      parts.push({ id: { in: await this.birthdayIds(tx, tenantId, filters.birthday, now) } })
    }

    return parts.length === 1 ? (parts[0] ?? {}) : { AND: parts }
  }

  /** Участия, чей день рождения попадает в окно, — по часам заведения. */
  private async birthdayIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    window: GuestBirthdayWindow,
    now: Date,
  ): Promise<string[]> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const today = localDay(tenant?.timezone ?? 'Asia/Bangkok', now)

    const rows = await tx.membership.findMany({
      where: { tenantId, guest: { birthday: { not: null } } },
      select: { id: true, guest: { select: { birthday: true } } },
    })

    return rows.flatMap((row) =>
      row.guest.birthday !== null && birthdayInWindow(row.guest.birthday, today, window)
        ? [row.id]
        : [],
    )
  }
}
