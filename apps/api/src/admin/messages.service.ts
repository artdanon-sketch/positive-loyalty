import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminGuestMessage,
  AdminMessagesList,
  AdminMessagesQuery,
  ReplyGuestMessageInput,
} from '@positive/contracts'

import { maskPhone } from '../common/pii/mask-phone'
import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Жалобы и предложения в бэк-офисе. docs/02, раздел 5.15 · docs/03, раздел 8.
 *
 * ЖДУТ ОТВЕТА — ПО ВСЕМУ ЗАВЕДЕНИЮ, А НЕ ПО ФИЛЬТРУ. Владелец, открывший «предложения»,
 * должен видеть, что где-то висят три неотвеченные жалобы, — иначе фильтр прячет работу.
 *
 * ТЕЛЕФОН — ПО РОЛИ, как в отзывах и списке гостей: целиком владельцу, маскированный
 * менеджеру.
 *
 * УЧАСТИЕ ГОСТЯ ИЩЕМ ОТДЕЛЬНО: обращение не привязано к чеку, а карточку гостя
 * бэк-офис открывает по участию в этом заведении. Участия нет — гость вышел из программы;
 * обращение остаётся, просто без ссылки.
 */

type Tx = Prisma.TransactionClient

const MESSAGE_SELECT = {
  id: true,
  guestId: true,
  kind: true,
  text: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  guest: { select: { displayName: true, phoneE164: true } },
} as const

type MessageRow = Prisma.GuestMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminMessagesQuery): Promise<AdminMessagesList> {
    const { tenantId, role } = TenantContext.getOrThrow()

    const where: Prisma.GuestMessageWhereInput = {
      tenantId,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.answered === undefined
        ? {}
        : { reply: query.answered === 'yes' ? { not: null } : null }),
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      const [rows, total, unanswered] = await Promise.all([
        tx.guestMessage.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: query.offset,
          take: query.limit,
          select: MESSAGE_SELECT,
        }),
        tx.guestMessage.count({ where }),
        tx.guestMessage.count({ where: { tenantId, reply: null } }),
      ])

      const memberships = await this.membershipIds(tx, tenantId, rows)

      return {
        total,
        unanswered,
        // Гость без участия (вышел из программы) остаётся в списке: его обращение никуда
        // не делось, просто ссылки на карточку у него нет.
        items: rows.map((row) =>
          toAdminMessage(row, memberships.get(row.guestId) ?? null, role === 'OWNER'),
        ),
      }
    })
  }

  async reply(id: string, input: ReplyGuestMessageInput): Promise<AdminGuestMessage> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.guestMessage.findFirst({
        where: { id, tenantId },
        select: { reply: true },
      })

      if (current === null) {
        // Чужое обращение — 404, а не 403: по ответу не должно быть видно, что оно есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Обращение не найдено' },
        })
      }

      const row = await tx.guestMessage.update({
        where: { id },
        data: { reply: input.text, repliedAt: new Date(), repliedBy: actorId },
        select: MESSAGE_SELECT,
      })

      const memberships = await this.membershipIds(tx, tenantId, [row])

      return {
        before: current,
        after: toAdminMessage(row, memberships.get(row.guestId) ?? null, role === 'OWNER'),
      }
    })

    await this.audit.write({
      action: 'GUEST_MESSAGE_REPLIED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'GuestMessage',
      entityId: id,
      oldValue: { reply: before.reply },
      newValue: { reply: after.reply },
    })

    return after
  }

  private async membershipIds(
    tx: Tx,
    tenantId: string,
    rows: ReadonlyArray<{ guestId: string }>,
  ): Promise<Map<string, string>> {
    const guestIds = [...new Set(rows.map((row) => row.guestId))]

    if (guestIds.length === 0) {
      return new Map()
    }

    const memberships = await tx.membership.findMany({
      where: { tenantId, guestId: { in: guestIds } },
      select: { id: true, guestId: true },
    })

    return new Map(memberships.map((row) => [row.guestId, row.id]))
  }
}

const toAdminMessage = (
  row: MessageRow,
  membershipId: string | null,
  showFullPhone: boolean,
): AdminGuestMessage => ({
  id: row.id,
  kind: row.kind,
  text: row.text,
  reply: row.reply,
  repliedAt: row.repliedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  guest: {
    guestId: row.guestId,
    membershipId,
    displayName: row.guest.displayName,
    phone: showFullPhone ? row.guest.phoneE164 : maskPhone(row.guest.phoneE164),
  },
})
