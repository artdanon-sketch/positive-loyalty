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
import { Prisma } from '../generated/prisma/client'
import { episodeOf } from './automation-episode'
import { assertGiftUsable, parseGift } from './broadcast-gift.service'
import { GuestAudienceService } from './guest-audience.service'

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
 *
 * «ЖДУТ» ВИДНО ДО ВКЛЮЧЕНИЯ. У каждого сценария — сколько гостей подходят прямо
 * сейчас и ещё не получали этот эпизод. С подарком это цена решения: включить
 * «сертификат всем спящим» при сорока спящих и при четырёхстах — разные решения.
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
  gift: unknown
  lastRunAt: Date | null
}

const RULE_SELECT = {
  kind: true,
  enabled: true,
  threshold: true,
  text: true,
  gift: true,
  lastRunAt: true,
} as const

const toRule = (row: RuleRow, waiting: number): AutomationRule => ({
  kind: row.kind,
  enabled: row.enabled,
  threshold: row.threshold,
  text: row.text,
  gift: parseGift(row.gift),
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
  waiting,
})

/** Гость, которому сценарий напишет при следующем запуске, и его эпизод. */
export interface Newcomer {
  readonly guestId: string
  readonly episode: string
}

/**
 * Кто подходит под условие сценария и ещё не получал этот эпизод.
 *
 * Один расчёт на запуск и на экран: «ждут 37» на экране обязано совпасть
 * с тем, сколько гостей получат письмо наутро.
 */
export const newcomers = async (
  tx: Prisma.TransactionClient,
  audience: GuestAudienceService,
  tenantId: string,
  kind: AutomationKind,
  threshold: number,
): Promise<Newcomer[]> => {
  const where = await audience.where(tx, tenantId, audienceOf(kind, threshold))
  const candidates = await tx.membership.findMany({
    where,
    select: { guestId: true, lastVisitAt: true },
  })

  if (candidates.length === 0) {
    return []
  }

  const hits = await tx.automationHit.findMany({
    where: { tenantId, kind, guestId: { in: candidates.map((row) => row.guestId) } },
    select: { guestId: true, episode: true },
  })
  const done = new Set(hits.map((hit) => `${hit.guestId}|${hit.episode}`))

  return candidates
    .map((row) => ({ guestId: row.guestId, episode: episodeOf(kind, threshold, row.lastVisitAt) }))
    .filter((row) => !done.has(`${row.guestId}|${row.episode}`))
}

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly audience: GuestAudienceService,
  ) {}

  async list(): Promise<AutomationRules> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const saved = await tx.automationRule.findMany({ where: { tenantId }, select: RULE_SELECT })
      const byKind = new Map(saved.map((row) => [row.kind, row]))

      // Порядок — из перечисления контракта: экран не должен зависеть от того,
      // какой сценарий владелец включил первым.
      const items: AutomationRule[] = []

      for (const kind of AutomationKind.options) {
        const row: RuleRow = byKind.get(kind) ?? {
          kind,
          enabled: false,
          ...DEFAULTS[kind],
          gift: null,
          lastRunAt: null,
        }
        const waiting = (await newcomers(tx, this.audience, tenantId, kind, row.threshold)).length

        items.push(toRule(row, waiting))
      }

      return { items }
    })
  }

  async save(kind: AutomationKind, input: SaveAutomationInput): Promise<AutomationRule> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const saved = await this.prisma.forTenant(tenantId, async (tx) => {
      await assertGiftUsable(tx, tenantId, input.gift)

      // Нет ключа — подарок не трогаем; null — снимаем; объект — ставим.
      const gift =
        input.gift === undefined ? {} : { gift: input.gift === null ? Prisma.DbNull : input.gift }

      const row = await tx.automationRule.upsert({
        where: { tenantId_kind: { tenantId, kind } },
        create: {
          tenantId,
          kind,
          enabled: input.enabled,
          threshold: input.threshold,
          text: input.text,
          ...gift,
        },
        update: { enabled: input.enabled, threshold: input.threshold, text: input.text, ...gift },
        select: RULE_SELECT,
      })

      const waiting = (await newcomers(tx, this.audience, tenantId, kind, row.threshold)).length

      return toRule(row, waiting)
    })

    await this.audit.write({
      action: 'AUTOMATION_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'AutomationRule',
      entityId: kind,
      newValue: { enabled: saved.enabled, threshold: saved.threshold, gift: saved.gift },
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
