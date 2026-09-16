import { Injectable } from '@nestjs/common'
import type { AdminGuestFilters } from '@positive/contracts'

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
    const where: Prisma.MembershipWhereInput = {
      tenantId,
      ...guestFilterWhere(tenantId, filters, now),
    }

    if (filters.segment === undefined) {
      return where
    }

    const ids = await this.reports.membershipIdsIn(tx, tenantId, filters.segment)

    return { AND: [where, { id: { in: ids } }] }
  }
}
