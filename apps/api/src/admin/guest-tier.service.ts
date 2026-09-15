import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { parseProgramConfig } from '@positive/contracts'
import type { GuestTierResult, SetGuestTierInput, Tier } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import { MEMBERSHIP_RULES_SELECT, MembershipRulesService } from '../core/membership-rules.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Ручной статус гостя. docs/11, У3.
 *
 * НАЗНАЧИТЬ — ЗНАЧИТ ЗАКРЕПИТЬ. Ручной статус не пересчитывается после чека:
 * скрытый «VIP для друзей» не слетает, а понижение не отменяется следующим обедом.
 *
 * ВЕРНУТЬ НА ЛЕСТНИЦУ — ЗНАЧИТ ПОСЧИТАТЬ С ЧИСТОГО ЛИСТА. Прежний ручной статус
 * в расчёт не идёт: иначе правило «статус не понижается» оставило бы гостю
 * «VIP», который с него только что сняли.
 */
@Injectable()
export class GuestTierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: MembershipRulesService,
    private readonly audit: AuditService,
  ) {}

  async set(guestId: string, input: SetGuestTierInput): Promise<GuestTierResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()

    const change = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })
      const config = parseProgramConfig(tenant?.settings ?? {})

      const membership = await tx.membership.findFirst({
        where: { guestId, tenantId },
        select: MEMBERSHIP_RULES_SELECT,
      })

      if (membership === null) {
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } })
      }

      const tier: Tier | null =
        input.tierId === null
          ? (
              await this.rules.tierFor(tx, tenantId, config, {
                ...membership,
                tierId: null,
                tierManual: false,
              })
            ).tier
          : (config.tiers.find((candidate) => candidate.id === input.tierId) ?? null)

      if (input.tierId !== null && tier === null) {
        throw new BadRequestException({
          error: { code: 'UNKNOWN_TIER', message: 'Такого статуса нет в настройках программы' },
        })
      }

      const manual = input.tierId !== null

      await tx.membership.update({
        where: { id: membership.id },
        data: { tierId: tier?.id ?? null, tierManual: manual },
      })

      return {
        membershipId: membership.id,
        before: { tierId: membership.tierId, manual: membership.tierManual },
        after: { tierId: tier?.id ?? null, manual },
        name: tier?.name ?? null,
      }
    })

    await this.audit.write({
      action: 'GUEST_TIER_CHANGED',
      actorType: 'OWNER',
      actorId,
      tenantId,
      entityType: 'Membership',
      entityId: change.membershipId,
      oldValue: change.before,
      newValue: { ...change.after, guestId },
      reason: input.reason,
      requestId,
    })

    return { tierId: change.after.tierId, name: change.name, manual: change.after.manual }
  }
}
