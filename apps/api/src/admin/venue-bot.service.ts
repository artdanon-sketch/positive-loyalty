import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import type { ConnectVenueBotInput, VenueBotStatus } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import { TelegramApiFactory } from '../identity/telegram-api.factory'

/**
 * Свой бот заведения. docs/02, раздел 5.18.
 *
 * КЛЮЧ ПРОВЕРЯЕТСЯ У TELEGRAM, А НЕ У НАС. Владелец копирует его из переписки
 * с @BotFather и легко приносит половину строки или ключ чужого бота. Спросить
 * `getMe` — секунда; молча сохранить нерабочий ключ — это тихо выключенные
 * рассылки, которые обнаружатся через неделю.
 *
 * КЛЮЧ ОБРАТНО НЕ ПОКАЗЫВАЕТСЯ. Потерявший его владелец берёт новый
 * у @BotFather: это его бот, а не наш, и хранить чужой секрет «на всякий
 * случай для показа» мы не обязаны.
 *
 * ОТКЛЮЧЕНИЕ НЕ УДАЛЯЕТ ПЕРЕПИСКУ. Гости, запустившие бота, остаются
 * записанными: владелец, вернувший бота через день, не потеряет подписчиков.
 */

/** «••••4821»: хвоста хватает, чтобы сверить с тем, что выдал @BotFather. */
const mask = (token: string): string => `••••${token.slice(-4)}`

@Injectable()
export class VenueBotService {
  private readonly logger = new Logger(VenueBotService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramApiFactory,
  ) {}

  async status(): Promise<VenueBotStatus> {
    const { tenantId } = TenantContext.getOrThrow()

    const [bot, subscribers] = await this.prisma.forTenant(tenantId, async (tx) =>
      Promise.all([
        tx.venueBot.findFirst({
          where: { tenantId },
          select: { username: true, token: true, isActive: true, createdAt: true },
        }),
        tx.venueBotChat.count({ where: { tenantId, blockedAt: null } }),
      ]),
    )

    return {
      connected: bot?.isActive ?? false,
      username: bot?.username ?? null,
      tokenMasked: bot === null ? null : mask(bot.token),
      subscribers,
      connectedAt: bot?.createdAt.toISOString() ?? null,
    }
  }

  async connect(input: ConnectVenueBotInput): Promise<VenueBotStatus> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const username = await this.usernameOf(input.token)

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.venueBot.upsert({
        where: { tenantId },
        create: { tenantId, token: input.token, username },
        update: { token: input.token, username, isActive: true },
      })
    })

    await this.audit.write({
      action: 'VENUE_BOT_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'VenueBot',
      entityId: tenantId,
      // Ключа в истории нет и не будет: она читается людьми.
      newValue: { username, connected: true },
    })

    return this.status()
  }

  async disconnect(): Promise<VenueBotStatus> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.venueBot.updateMany({ where: { tenantId }, data: { isActive: false } })
    })

    await this.audit.write({
      action: 'VENUE_BOT_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'VenueBot',
      entityId: tenantId,
      newValue: { connected: false },
    })

    return this.status()
  }

  /** Спрашиваем Telegram, чей это ключ: он же скажет, если ключ нерабочий. */
  private async usernameOf(token: string): Promise<string> {
    try {
      const me = await this.telegram.for(token).getMe()

      return me.username
    } catch (error) {
      this.logger.warn(
        `Ключ бота не принят Telegram: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )

      throw new BadRequestException({
        error: {
          code: 'BOT_TOKEN_REJECTED',
          message: 'Telegram не принял этот ключ. Проверьте, что скопировали его целиком.',
        },
      })
    }
  }
}
