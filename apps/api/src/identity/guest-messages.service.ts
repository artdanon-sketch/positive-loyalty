import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { GUEST_MESSAGES_MAX, GUEST_MESSAGES_PENDING_MAX } from '@positive/contracts'
import type { CreateGuestMessageInput, GuestMessageView, GuestMessages } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { currentGuestId } from './current-guest'

/**
 * Жалобы и предложения гостя. docs/02, раздел 2.10.
 *
 * ГРАНИЦУ ДЕРЖИТ БАЗА. Гостевой контур RLS (`guest_messages_*`, миграция 20260916160000)
 * отдаёт гостю только его обращения, а записать даёт только за себя, только заведению
 * с его участием и только без ответа. Проверки ниже — чтобы ответить понятным кодом.
 *
 * ПОТОК ОГРАНИЧЕН НЕОТВЕЧЕННЫМИ, А НЕ СУТКАМИ. Заведение, которое отвечает, читает
 * и следующее письмо; молчащее — не получает поток. Счёт по суткам наказывал бы гостя,
 * которому есть что сказать, ровно так же, как спамера.
 */

const VENUE_NOT_FOUND = {
  error: { code: 'VENUE_NOT_FOUND', message: 'Заведение не найдено' },
}

const LIMIT_REACHED = {
  error: {
    code: 'MESSAGE_LIMIT_REACHED',
    message: 'Дождитесь ответа на прошлые обращения',
  },
}

const MESSAGE_SELECT = {
  id: true,
  tenantId: true,
  kind: true,
  text: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  tenant: { select: { brandName: true } },
} as const

type MessageRow = Prisma.GuestMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

const toView = (row: MessageRow): GuestMessageView => ({
  id: row.id,
  tenantId: row.tenantId,
  venue: row.tenant.brandName,
  kind: row.kind,
  text: row.text,
  reply: row.reply,
  repliedAt: row.repliedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

@Injectable()
export class GuestMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Свои обращения с ответами — свежие сверху. */
  async list(): Promise<GuestMessages> {
    const guestId = currentGuestId()

    const rows = await this.prisma.forGuest(guestId, async (tx) =>
      tx.guestMessage.findMany({
        where: { guestId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: GUEST_MESSAGES_MAX,
        select: MESSAGE_SELECT,
      }),
    )

    return { items: rows.map(toView) }
  }

  async create(input: CreateGuestMessageInput): Promise<GuestMessageView> {
    const guestId = currentGuestId()

    return this.prisma.forGuest(guestId, async (tx) => {
      // Участие проверяем явно: под владельцем базы (тесты, миграции) политика молчит,
      // а без неё обращения стали бы каналом к незнакомому заведению.
      const membership = await tx.membership.findFirst({
        where: { tenantId: input.tenantId, guestId },
        select: { id: true },
      })

      if (membership === null) {
        // 404, а не 403: гость не должен узнавать, существует ли такое заведение.
        throw new NotFoundException(VENUE_NOT_FOUND)
      }

      const pending = await tx.guestMessage.count({
        where: { guestId, tenantId: input.tenantId, reply: null },
      })

      if (pending >= GUEST_MESSAGES_PENDING_MAX) {
        throw new ConflictException(LIMIT_REACHED)
      }

      const row = await tx.guestMessage.create({
        data: {
          tenantId: input.tenantId,
          guestId,
          kind: input.kind,
          text: input.text,
        },
        select: MESSAGE_SELECT,
      })

      return toView(row)
    })
  }
}
