import { Injectable } from '@nestjs/common'
import type { PlatformComplaintsResult, PlatformComplaintsReviewResult } from '@positive/contracts'

import { AuditService } from '../core/audit.service'
import { SUSPEND_COMPLAINTS } from '../partnerships/invite-restriction'

import { groupComplaints } from './invite-complaints'
import { PlatformPrismaService } from './platform-prisma.service'

/**
 * Разбор жалоб на спам в приглашениях. docs/07, раздел 6.2.
 *
 * ПЛАТФОРМА ВИДИТ ТО, ЧЕГО НЕ ВИДИТ ОБВИНЁННЫЙ: кто пожаловался и почему.
 * Обвинённому это знать незачем — имя жалобщика стало бы поводом для ответной.
 * Разбирающему без этого не обойтись: пять жалоб от сети конкурентов и пять
 * от случайных соседей — разные истории.
 *
 * РАЗБОР — ОТМЕТКА, А НЕ ПРИГОВОР. «Разобрано» снимает приостановку приглашений;
 * если заведение продолжит, новые жалобы приостановят его снова. Других санкций
 * у платформы пока нет, и притворяться, что они есть, панель не должна.
 */

/** Больше неразобранных жалоб разом — это уже не разбор, а пожар, и он виден и так. */
const OPEN_LIMIT = 500

@Injectable()
export class PlatformComplaintsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  async open(): Promise<PlatformComplaintsResult> {
    const strikes = await this.prisma.inviteStrike.findMany({
      where: { kind: 'SPAM', reviewedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: OPEN_LIMIT,
      select: {
        againstTenantId: true,
        fromTenantId: true,
        createdAt: true,
        againstTenant: { select: { brandName: true } },
        fromTenant: { select: { brandName: true } },
      },
    })

    const reasons =
      strikes.length === 0
        ? []
        : await this.prisma.inviteBlock.findMany({
            where: {
              OR: strikes.map((strike) => ({
                blockerTenantId: strike.fromTenantId,
                blockedTenantId: strike.againstTenantId,
              })),
            },
            select: { blockerTenantId: true, blockedTenantId: true, reason: true },
          })

    return {
      items: groupComplaints(
        strikes.map((strike) => ({
          againstTenantId: strike.againstTenantId,
          againstBrandName: strike.againstTenant.brandName,
          fromTenantId: strike.fromTenantId,
          fromBrandName: strike.fromTenant.brandName,
          createdAt: strike.createdAt,
        })),
        reasons,
      ),
      suspendAfter: SUSPEND_COMPLAINTS,
    }
  }

  /**
   * Отметить жалобы на заведение разобранными.
   *
   * Повторное нажатие ничего не меняет и следа в аудите не оставляет: разбирать
   * уже нечего, а двойной клик не должен выглядеть двумя решениями.
   */
  async review(
    tenantId: string,
    adminId: string,
    now: Date,
  ): Promise<PlatformComplaintsReviewResult> {
    const reviewed = await this.prisma.inviteStrike.updateMany({
      where: { againstTenantId: tenantId, kind: 'SPAM', reviewedAt: null },
      data: { reviewedAt: now, reviewedBy: adminId },
    })

    if (reviewed.count > 0) {
      await this.audit.write({
        action: 'INVITE_COMPLAINTS_REVIEWED',
        actorType: 'PLATFORM_ADMIN',
        actorId: adminId,
        tenantId,
        entityType: 'Tenant',
        entityId: tenantId,
        newValue: { reviewed: reviewed.count },
      })
    }

    return { tenantId, reviewed: reviewed.count }
  }
}
