import { Injectable, Logger } from '@nestjs/common'
import type { ProgramConfig, Tier } from '@positive/contracts'

import type { Prisma } from '../generated/prisma/client'
import { IdempotencyKeyReusedError } from './ledger.errors'
import { LedgerService } from './ledger.service'
import { PrismaService } from './prisma.service'
import { checkRates, needsReferrals, resolveTier } from './tiers'
import type { CheckRates } from './tiers'

/**
 * Правила участия поверх журнала: статус гостя и приветственные баллы.
 * docs/01, раздел 4.3 · docs/11, У3.
 *
 * Одна точка для кассы, вебхука и ручной правки: статус и ставки считаются
 * одинаково, откуда бы ни пришёл чек. Решения — в tiers.ts; здесь только
 * чтение участия и запись.
 */

type Tx = Prisma.TransactionClient

/** Что правилам нужно знать об участии. */
export const MEMBERSHIP_RULES_SELECT = {
  id: true,
  tierId: true,
  tierManual: true,
  spentTotal: true,
  visitsTotal: true,
  isControlGroup: true,
} as const

export interface MembershipSnapshot {
  readonly id: string
  readonly tierId: string | null
  readonly tierManual: boolean
  readonly spentTotal: number
  readonly visitsTotal: number
  readonly isControlGroup: boolean
}

export interface TierOutcome {
  readonly tier: Tier | null
  readonly rates: CheckRates
}

export type WelcomeMoment = 'JOIN' | 'FIRST_PURCHASE'

const TRIGGER: Readonly<Record<WelcomeMoment, ProgramConfig['welcomeBonus']['trigger']>> = {
  JOIN: 'ON_JOIN',
  FIRST_PURCHASE: 'ON_FIRST_PURCHASE',
}

@Injectable()
export class MembershipRulesService {
  private readonly logger = new Logger(MembershipRulesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Статус и ставки для чека — внутри транзакции вызывающего. */
  async tierFor(
    tx: Tx,
    tenantId: string,
    config: ProgramConfig,
    membership: MembershipSnapshot,
  ): Promise<TierOutcome> {
    const referrals = needsReferrals(config.tiers)
      ? await tx.membership.count({ where: { tenantId, referredById: membership.id } })
      : 0

    const tier = resolveTier(config.tiers, {
      tierId: membership.tierId,
      tierManual: membership.tierManual,
      spentTotal: membership.spentTotal,
      visitsTotal: membership.visitsTotal,
      referrals,
    })

    return { tier, rates: checkRates(config, tier) }
  }

  /**
   * Пересчитать и запомнить статус после чека.
   *
   * Сохранённый статус — то, что видят экраны и отчёты; касса ставки всё равно
   * считает заново. Запись условная: ручной статус, назначенный, пока шёл чек,
   * пересчёт не перетрёт.
   */
  async refreshTier(tenantId: string, membershipId: string, config: ProgramConfig): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: MEMBERSHIP_RULES_SELECT,
      })

      if (membership === null || membership.tierManual) {
        return
      }

      const { tier } = await this.tierFor(tx, tenantId, config, membership)
      const tierId = tier?.id ?? null

      if (tierId !== membership.tierId) {
        await tx.membership.updateMany({
          where: { id: membershipId, tenantId, tierManual: false },
          data: { tierId },
        })
      }
    })
  }

  /**
   * Приветственные баллы. Возвращает баланс после подарка или null, если подарка нет.
   *
   * ОДИН ПОДАРОК НА УЧАСТИЕ. Ключ журнала — `welcome:{участие}`: повтор сканирования,
   * повтор чека и гонка двух касс упираются в один и тот же ключ.
   *
   * ТОЛЬКО ДО ПЕРВОГО ВИЗИТА. Условие «визитов ещё нет» делает вызов дешёвым
   * на каждом сканировании: у постоянного гостя до журнала дело не доходит.
   *
   * Контрольной группе не положено: у неё нет баллов вовсе (docs/01, раздел 4.2).
   */
  async grantWelcome(
    tenantId: string,
    membership: Pick<MembershipSnapshot, 'id' | 'visitsTotal' | 'isControlGroup'>,
    config: ProgramConfig,
    moment: WelcomeMoment,
  ): Promise<number | null> {
    const bonus = config.welcomeBonus

    if (
      !bonus.enabled ||
      bonus.amount <= 0 ||
      bonus.trigger !== TRIGGER[moment] ||
      membership.isControlGroup ||
      membership.visitsTotal > 0
    ) {
      return null
    }

    const idempotencyKey = `welcome:${membership.id}`

    // Подарок уже у гостя. Проверяем заранее, а не повтором журнала: если владелец
    // с тех пор поменял сумму, повтор с новой суммой журнал справедливо счёл бы
    // чужой операцией — и сканирование гостя упало бы.
    const already = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } }),
    )

    if (already !== null) {
      return null
    }

    try {
      const result = await this.ledger.grant(
        {
          membershipId: membership.id,
          amount: bonus.amount,
          idempotencyKey,
          source: 'SYSTEM',
          actorType: 'SYSTEM',
        },
        { tenantId },
      )

      return result.entry.balanceAfter
    } catch (error) {
      // Две кассы и смена суммы посередине: подарок уже записан первой.
      if (error instanceof IdempotencyKeyReusedError) {
        this.logger.warn(`Приветственные баллы участия ${membership.id} уже выданы`)
        return null
      }

      throw error
    }
  }
}
