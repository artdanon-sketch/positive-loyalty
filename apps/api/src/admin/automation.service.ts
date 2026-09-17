import { Injectable } from '@nestjs/common'
import { AutomationKind } from '@positive/contracts'
import type {
  AutomationRule,
  AutomationRules,
  BroadcastAudience,
  SaveAutomationInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
/**
 * Автоматические сценарии рассылок в бэк-офисе. docs/02, раздел 5.4.1.
 *
 * ТРИ СЦЕНАРИЯ ВСЕГДА ЕСТЬ НА ЭКРАНЕ, даже если их никогда не включали:
 * владелец должен видеть, что умеет система, а не догадываться по пустому
 * списку. Выключенный сценарий — строка с умолчаниями, а не отсутствие строки.
 *
 * ПОРОГИ ПО УМОЛЧАНИЮ ВЗЯТЫ ИЗ ЖИЗНИ КАФЕ: месяц без визита — уже потеря,
 * неделя после вступления без покупки — забытая карта, десять тысяч батов —
 * гость, которого стоит поблагодарить.
 */

const DEFAULTS: Readonly<Record<AutomationKind, { threshold: number; text: string }>> = {
  SLEEPING: {
    threshold: 30,
    text: 'Соскучились! Заходите — у нас для вас всё как вы любите.',
  },
  JOINED_NO_PURCHASE: {
    threshold: 7,
    text: 'Вы с нами, но ещё не заглядывали. Ждём вас — будет вкусно.',
  },
  SPENT_TOTAL: {
    threshold: 1_000_000,
    text: 'Спасибо, что вы с нами! Вы один из самых любимых наших гостей.',
  },
}

interface RuleRow {
  kind: AutomationKind
  enabled: boolean
  threshold: number
  text: string
  lastRunAt: Date | null
}

const toRule = (row: RuleRow): AutomationRule => ({
  kind: row.kind,
  enabled: row.enabled,
  threshold: row.threshold,
  text: row.text,
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
})

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AutomationRules> {
    const { tenantId } = TenantContext.getOrThrow()

    const saved = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.automationRule.findMany({
        where: { tenantId },
        select: { kind: true, enabled: true, threshold: true, text: true, lastRunAt: true },
      }),
    )

    const byKind = new Map(saved.map((row) => [row.kind, row]))

    // Порядок — из перечисления контракта: экран не должен зависеть от того,
    // какой сценарий владелец включил первым.
    return {
      items: AutomationKind.options.map((kind) => {
        const row = byKind.get(kind)

        return row === undefined
          ? { kind, enabled: false, ...DEFAULTS[kind], lastRunAt: null }
          : toRule(row)
      }),
    }
  }

  async save(kind: AutomationKind, input: SaveAutomationInput): Promise<AutomationRule> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const saved = await this.prisma.forTenant(tenantId, async (tx) => {
      const row = await tx.automationRule.upsert({
        where: { tenantId_kind: { tenantId, kind } },
        create: {
          tenantId,
          kind,
          enabled: input.enabled,
          threshold: input.threshold,
          text: input.text,
        },
        update: { enabled: input.enabled, threshold: input.threshold, text: input.text },
        select: { kind: true, enabled: true, threshold: true, text: true, lastRunAt: true },
      })

      return toRule(row)
    })

    await this.audit.write({
      action: 'AUTOMATION_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'AutomationRule',
      entityId: kind,
      newValue: { enabled: saved.enabled, threshold: saved.threshold },
    })

    return saved
  }
}

/** Условие сценария в виде фильтров аудитории рассылки. */
export const audienceOf = (kind: AutomationKind, threshold: number): BroadcastAudience => {
  switch (kind) {
    case 'SLEEPING':
      // «Спящие» — те, кто был, но не заходил дольше порога (guest-search.ts).
      return { sleeping: threshold }
    case 'JOINED_NO_PURCHASE':
      // Гость без единой покупки, вступивший достаточно давно: писать на
      // следующее утро после регистрации — значит торопить того, кто ещё
      // не успел дойти.
      return { buyers: 'none', joinedBefore: threshold }
    case 'SPENT_TOTAL':
      return { spentFrom: threshold }
  }
}
