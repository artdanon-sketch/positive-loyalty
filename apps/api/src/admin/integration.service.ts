import { Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import type { IntegrationSecret, IntegrationStatus, RotateSecretInput } from '@positive/contracts'

import { getEnv } from '../common/config/env'
import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Состояние связки с кассой. docs/02, раздел 5.16.
 *
 * ОТВЕЧАЕТ НА ОДИН ВОПРОС: «почему чеки не приходят». Поэтому здесь не настройки,
 * а факты — подключено ли, куда слать, сколько принято за неделю и сколько
 * из этого не разобралось.
 *
 * КЛЮЧ НА ЭКРАНЕ ВСЕГДА ЗАМАСКИРОВАН. Полный отдаётся отдельным запросом и
 * пишется в историю: им подписывают чеки, и кто им владеет — начисляет баллы
 * от имени заведения.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** «pos_••••4821»: хвоста хватает, чтобы сверить с тем, что введено в кассе. */
const mask = (secret: string): string =>
  secret.length <= 4 ? '••••' : `${'•'.repeat(4)}${secret.slice(-4)}`

@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<IntegrationStatus> {
    const { tenantId } = TenantContext.getOrThrow()
    const since = new Date(Date.now() - WEEK_MS)

    const [link, received, pending, failed, last] = await this.prisma.forTenant(
      tenantId,
      async (tx) =>
        Promise.all([
          tx.posLink.findFirst({
            where: { tenantId, isActive: true },
            orderBy: { linkedAt: 'desc' },
            select: {
              posMerchantId: true,
              callbackUrl: true,
              webhookSecret: true,
              linkedAt: true,
            },
          }),
          tx.webhookEvent.count({ where: { tenantId, receivedAt: { gte: since } } }),
          tx.webhookEvent.count({ where: { tenantId, status: 'PENDING' } }),
          tx.webhookEvent.count({ where: { tenantId, status: 'FAILED' } }),
          tx.webhookEvent.findFirst({
            where: { tenantId },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
          }),
        ]),
    )

    return {
      connected: link !== null,
      posMerchantId: link?.posMerchantId ?? null,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      // Адрес приёма один на все заведения: кто прислал чек, сервер узнаёт
      // по подписи и идентификатору заведения в теле, а не по адресу.
      inboundUrl: `${getEnv().publicApiUrl}/webhooks/pos/receipt-closed`,
      callbackUrl: link?.callbackUrl ?? null,
      secretMasked: link === null ? null : mask(link.webhookSecret),
      receivedWeek: received,
      pending,
      failed,
      lastEventAt: last?.receivedAt.toISOString() ?? null,
    }
  }

  /**
   * Показать полный ключ.
   *
   * Отдельным запросом и с записью в историю — как показ телефона гостя
   * (docs/05, раздел 4): ключ выдаётся человеку, а не рисуется на экране
   * «на всякий случай».
   */
  async revealSecret(): Promise<IntegrationSecret> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const link = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.posLink.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { linkedAt: 'desc' },
        select: { id: true, webhookSecret: true },
      }),
    )

    if (link === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Касса не подключена' },
      })
    }

    await this.audit.write({
      action: 'INTEGRATION_SECRET_REVEALED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'PosLink',
      entityId: link.id,
    })

    return { secret: link.webhookSecret }
  }

  /**
   * Перевыпустить ключ.
   *
   * ПОСЛЕ ЭТОГО КАССА ПЕРЕСТАЁТ ПРИСЫЛАТЬ ЧЕКИ, пока в ней не поменяют ключ:
   * старая подпись перестаёт сходиться в ту же секунду. Поэтому причина
   * обязательна и уходит в историю — это действие с последствиями для зала.
   */
  async rotateSecret(input: RotateSecretInput): Promise<IntegrationSecret> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const secret = randomBytes(24).toString('base64url')

    const link = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.posLink.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { linkedAt: 'desc' },
        select: { id: true },
      })

      if (current === null) {
        return null
      }

      await tx.posLink.update({ where: { id: current.id }, data: { webhookSecret: secret } })

      return current
    })

    if (link === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Касса не подключена' },
      })
    }

    await this.audit.write({
      action: 'INTEGRATION_SECRET_ROTATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'PosLink',
      entityId: link.id,
      reason: input.reason,
    })

    return { secret }
  }
}
