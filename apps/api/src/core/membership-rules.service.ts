import { Injectable, Logger } from '@nestjs/common'
import type { ProgramConfig, Tier } from '@positive/contracts'

import type { Prisma } from '../generated/prisma/client'
import { IdempotencyKeyReusedError } from './ledger.errors'
import { LedgerService } from './ledger.service'
import { PrismaService } from './prisma.service'
import { REFERRAL_REWARD_KEY_PREFIX, referralRewardKey } from './referral-shares'
import { checkRates, needsReferrals, resolveTier } from './tiers'
import type { CheckRates } from './tiers'

/**
 * Правила участия поверх журнала: статус гостя, приветственные баллы и награда
 * за приглашённого друга. docs/01, раздел 4.3 · docs/11, У3 и У6.
 *
 * Одна точка для кассы, вебхука и ручной правки: статус и ставки считаются
 * одинаково, откуда бы ни пришёл чек. Решения — в tiers.ts; здесь только
 * чтение участия и запись.
 *
 * РЕКОМЕНДАЦИЯ ЗАСЧИТЫВАЕТСЯ ПОКУПКОЙ. Условие статуса «привёл друзей» считает
 * только друзей, у которых уже есть визит: пригласить можно кого угодно, а привести —
 * только того, кто пришёл и заплатил. Иначе статус набирался бы регистрациями
 * без единой покупки (docs/05, раздел 6.2).
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
  referredById: true,
} as const

export interface MembershipSnapshot {
  readonly id: string
  readonly tierId: string | null
  readonly tierManual: boolean
  readonly spentTotal: number
  readonly visitsTotal: number
  readonly isControlGroup: boolean
}

/** Что нужно знать о друге, чтобы наградить пригласившего. */
export interface ReferralFacts {
  readonly id: string
  readonly visitsTotal: number
  /** Участие, чья ссылка привела гостя. null — пришёл сам. */
  readonly referredById: string | null
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

/** Ключ приветственных баллов: один на участие навсегда. */
export const welcomeKey = (membershipId: string): string => `welcome:${membershipId}`

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
      ? await tx.membership.count({
          where: { tenantId, referredById: membership.id, visitsTotal: { gt: 0 } },
        })
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
   * Пересчитать статусы всех гостей заведения — после правки лестницы.
   *
   * Без этого список с фильтром «Золото» до следующего чека жил бы вчерашними
   * порогами, а карточка — сегодняшними. Ручные статусы не трогаются; правило
   * «автоматически только вверх» действует и здесь. Рекомендации — одним
   * запросом на заведение, а не запросом на каждого гостя.
   *
   * Возвращает, у скольких гостей статус изменился.
   */
  async refreshTenantTiers(tenantId: string, config: ProgramConfig): Promise<number> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { tenantId, tierManual: false },
        select: { id: true, tierId: true, spentTotal: true, visitsTotal: true },
      })

      const referrals = new Map<string, number>()

      if (needsReferrals(config.tiers)) {
        const counted = await tx.membership.groupBy({
          by: ['referredById'],
          where: { tenantId, referredById: { not: null }, visitsTotal: { gt: 0 } },
          _count: { _all: true },
        })

        for (const row of counted) {
          if (row.referredById !== null) {
            referrals.set(row.referredById, row._count._all)
          }
        }
      }

      const moves = new Map<string | null, string[]>()

      for (const membership of memberships) {
        const tierId =
          resolveTier(config.tiers, {
            tierId: membership.tierId,
            tierManual: false,
            spentTotal: membership.spentTotal,
            visitsTotal: membership.visitsTotal,
            referrals: referrals.get(membership.id) ?? 0,
          })?.id ?? null

        if (tierId !== membership.tierId) {
          moves.set(tierId, [...(moves.get(tierId) ?? []), membership.id])
        }
      }

      let changed = 0

      for (const [tierId, ids] of moves) {
        const updated = await tx.membership.updateMany({
          where: { tenantId, id: { in: ids }, tierManual: false },
          data: { tierId },
        })
        changed += updated.count
      }

      return changed
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
  /**
   * Сколько приветственных баллов положено гостю в этот момент — 0, если не положено.
   *
   * Одно правило для предрасчёта и для самой выдачи: касса показывает «подарок за
   * первую покупку» ровно тогда, когда проведение его выдаст. Раньше предрасчёт
   * о подарке молчал — кассир обещал «станет на карте 50 ฿», а становилось 100.
   */
  async welcomeDue(
    tenantId: string,
    membership: Pick<MembershipSnapshot, 'id' | 'visitsTotal' | 'isControlGroup'>,
    config: ProgramConfig,
    moment: WelcomeMoment,
  ): Promise<number> {
    const bonus = config.welcomeBonus

    if (
      !bonus.enabled ||
      bonus.amount <= 0 ||
      bonus.trigger !== TRIGGER[moment] ||
      membership.isControlGroup ||
      membership.visitsTotal > 0
    ) {
      return 0
    }

    // Подарок уже у гостя. Проверяем заранее, а не повтором журнала: если владелец
    // с тех пор поменял сумму, повтор с новой суммой журнал справедливо счёл бы
    // чужой операцией — и сканирование гостя упало бы.
    const already = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findUnique({
        where: { idempotencyKey: welcomeKey(membership.id) },
        select: { id: true },
      }),
    )

    return already === null ? bonus.amount : 0
  }

  async grantWelcome(
    tenantId: string,
    membership: Pick<MembershipSnapshot, 'id' | 'visitsTotal' | 'isControlGroup'>,
    config: ProgramConfig,
    moment: WelcomeMoment,
  ): Promise<number | null> {
    const bonus = config.welcomeBonus

    if ((await this.welcomeDue(tenantId, membership, config, moment)) === 0) {
      return null
    }

    const idempotencyKey = welcomeKey(membership.id)

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

  /**
   * Награда пригласившему за первую покупку друга. docs/11, У6 · docs/05, раздел 6.2.
   *
   * ДОЗРЕВАЕТ ПОКУПКОЙ, А НЕ ВСТУПЛЕНИЕМ. Вызывается на чеке друга до его начисления —
   * тем же порядком, что приветственные баллы: повтор чека упрётся в «визиты уже
   * есть» и в ключ.
   *
   * ОДНА НАГРАДА ЗА ДРУГА. Ключ журнала — `referral:{участие друга}`, ссылка
   * `referral` на то же участие: повтор чека, вебхук вслед за кассой и гонка двух
   * касс упираются в него.
   *
   * НЕ СВЕРХ ЛИМИТА. Считаются уже выданные награды пригласившего. Два друга,
   * купившие в одну секунду, могут перешагнуть лимит на одну награду: это дешевле
   * блокировки участия на каждом чеке.
   *
   * Контрольной группе баллов не положено — и за друзей тоже (docs/01, раздел 4.2).
   * Правило действует на момент покупки: выключили приглашения до первого чека
   * друга — награды нет.
   */
  async grantReferral(
    tenantId: string,
    friend: ReferralFacts,
    config: ProgramConfig,
  ): Promise<void> {
    const referral = config.referral
    const inviterId = friend.referredById

    if (!referral.enabled || referral.reward <= 0 || inviterId === null || friend.visitsTotal > 0) {
      return
    }

    const idempotencyKey = referralRewardKey(friend.id)

    const state = await this.prisma.forTenant(tenantId, async (tx) => {
      const [already, inviter, rewarded] = await Promise.all([
        tx.ledgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } }),
        tx.membership.findFirst({
          where: { id: inviterId, tenantId },
          select: { isControlGroup: true },
        }),
        // Только разовые награды: проценты с покупок друзей лимит не съедают.
        tx.ledgerEntry.count({
          where: {
            tenantId,
            membershipId: inviterId,
            type: 'GRANT',
            refType: 'referral',
            idempotencyKey: { startsWith: REFERRAL_REWARD_KEY_PREFIX },
          },
        }),
      ])

      return { already, inviter, rewarded }
    })

    if (
      state.already !== null ||
      state.inviter === null ||
      state.inviter.isControlGroup ||
      state.rewarded >= referral.limit
    ) {
      return
    }

    try {
      await this.ledger.grant(
        {
          membershipId: inviterId,
          amount: referral.reward,
          idempotencyKey,
          refType: 'referral',
          refId: friend.id,
          source: 'SYSTEM',
          actorType: 'SYSTEM',
        },
        { tenantId },
      )
    } catch (error) {
      // Касса и вебхук одного чека, и сумма награды сменилась посередине.
      if (error instanceof IdempotencyKeyReusedError) {
        this.logger.warn(`Награда за приглашённого ${friend.id} уже выдана`)
        return
      }

      throw error
    }
  }

  /**
   * Друг купил впервые — у пригласившего на одну рекомендацию больше, и статус
   * с условием «привёл друзей» поднимается сразу, а не с его следующего чека.
   * Вызывается ПОСЛЕ начисления другу: рекомендация засчитывается по визиту.
   * `friend` — снимок до чека.
   */
  async refreshInviterTier(
    tenantId: string,
    friend: ReferralFacts,
    config: ProgramConfig,
  ): Promise<void> {
    if (friend.referredById === null || friend.visitsTotal > 0 || !needsReferrals(config.tiers)) {
      return
    }

    await this.refreshTier(tenantId, friend.referredById, config)
  }
}
