import type { ProgramConfig, Tier, TierCondition } from '@positive/contracts'

/**
 * Статус гостя: какой положен и по каким ставкам считать чек.
 * docs/01, раздел 4.3 · docs/11, У3.
 *
 * ЧИСТЫЕ ФУНКЦИИ БЕЗ БАЗЫ. Касса, вебхук и ручная правка решают одинаково,
 * а границы — «ровно на пороге», «статус удалили из настроек» — проверяются
 * юнит-тестами.
 *
 * ЛЕСТНИЦА — ПОРЯДОК В НАСТРОЙКАХ. Первый статус — нижний, последний — верхний.
 * Статус без условий — входной: его получает любой участник.
 *
 * УСЛОВИЯ — «ЛЮБОЕ ИЗ», как у UDS: сумма покупок, число визитов или рекомендации.
 * Гость, набравший сумму за три визита, не должен ждать десятого. Порог строгий:
 * «больше чем», как и названо в настройках (`gt`).
 *
 * АВТОМАТИЧЕСКИ СТАТУС ТОЛЬКО РАСТЁТ. Отменённый чек или поднятый порог не
 * отбирают у гостя «Золото», которое он уже видел в приложении: разжалование
 * без объяснения бьёт по лояльности сильнее лишнего процента. Понизить можно
 * вручную — с причиной в аудите.
 *
 * РУЧНОЙ СТАТУС НЕ ПЕРЕСЧИТЫВАЕТСЯ. Скрытый «VIP для друзей» не слетает после
 * чека. Если статус удалили из настроек, ручной теряет смысл — гость
 * возвращается на лестницу.
 */

export interface TierFacts {
  readonly tierId: string | null
  readonly tierManual: boolean
  /** Оборот в минорных единицах. */
  readonly spentTotal: number
  readonly visitsTotal: number
  /** Сколько гостей привёл. Считать стоит, только если условие по рекомендациям есть. */
  readonly referrals: number
}

export interface CheckRates {
  /** Процент начисления от оплаченного деньгами. */
  readonly earnRate: number
  /** Какую долю чека можно оплатить баллами. */
  readonly redeemRate: number
}

const met = (condition: TierCondition, facts: TierFacts): boolean => {
  switch (condition.type) {
    case 'SPENT_TOTAL':
      return facts.spentTotal > condition.gt
    case 'VISITS_TOTAL':
      return facts.visitsTotal > condition.gt
    case 'REFERRALS':
      return facts.referrals > condition.gt
  }
}

/** Самый высокий открытый статус, который гость набрал сам. */
export const earnedTier = (tiers: readonly Tier[], facts: TierFacts): Tier | null => {
  let highest: Tier | null = null

  for (const tier of tiers) {
    // Скрытый статус назначается только руками — даже без условий.
    if (tier.hidden) {
      continue
    }

    if (
      tier.conditions.length === 0 ||
      tier.conditions.some((condition) => met(condition, facts))
    ) {
      highest = tier
    }
  }

  return highest
}

/** Статус, по которому гость живёт сейчас. */
export const resolveTier = (tiers: readonly Tier[], facts: TierFacts): Tier | null => {
  const stored = facts.tierId === null ? undefined : tiers.find((tier) => tier.id === facts.tierId)

  if (facts.tierManual && stored !== undefined) {
    return stored
  }

  const earned = earnedTier(tiers, facts)

  // Не понижаем: сохранённый статус лестницы выше набранного — остаётся он.
  if (!facts.tierManual && stored !== undefined && !stored.hidden) {
    if (earned === null || tiers.indexOf(stored) > tiers.indexOf(earned)) {
      return stored
    }
  }

  return earned
}

/** Рекомендации считаем, только если на них есть условие у открытого статуса. */
export const needsReferrals = (tiers: readonly Tier[]): boolean =>
  tiers.some(
    (tier) => !tier.hidden && tier.conditions.some((condition) => condition.type === 'REFERRALS'),
  )

/** Ставки чека: статус заменяет базовые, а не прибавляется к ним. */
export const checkRates = (
  config: Pick<ProgramConfig, 'baseEarnRate' | 'baseRedeemRate'>,
  tier: Tier | null,
): CheckRates =>
  tier === null
    ? { earnRate: config.baseEarnRate, redeemRate: config.baseRedeemRate }
    : { earnRate: tier.earnRate, redeemRate: tier.redeemRate }

export interface TierProgress {
  readonly next: Tier
  /** Сколько оборота не хватает, в минорных единицах. null — у следующего статуса нет такого условия. */
  readonly spentLeft: number | null
  /** Сколько визитов не хватает. null — такого условия нет. */
  readonly visitsLeft: number | null
}

/**
 * Сколько осталось до следующего статуса — для карты гостя.
 *
 * СЛЕДУЮЩИЙ — ПЕРВЫЙ ОТКРЫТЫЙ СТАТУС С УСЛОВИЯМИ ВЫШЕ ТЕКУЩЕГО. Скрытые сами
 * не даются, а статус без условий выше текущего не «достигается» — его бы уже дали.
 *
 * ОСТАЛОСЬ — ПО КАЖДОМУ УСЛОВИЮ ОТДЕЛЬНО: хватит любого. Порог строгий, поэтому
 * до «больше 1 000 ฿» при обороте 600 ฿ — 400,01 ฿, а до «больше четырёх визитов»
 * при одном — четыре.
 *
 * ПРОГРЕССА НЕТ у ручного и скрытого статуса — лестница к ним не применяется, —
 * и когда у следующего статуса только условие по рекомендациям: реферальной
 * программы ещё нет, и «приведите друзей» было бы обещанием без механики.
 */
export const tierProgress = (
  tiers: readonly Tier[],
  current: Tier | null,
  facts: TierFacts,
): TierProgress | null => {
  if (facts.tierManual || current?.hidden === true) {
    return null
  }

  const from = current === null ? -1 : tiers.indexOf(current)
  const next = tiers.slice(from + 1).find((tier) => !tier.hidden && tier.conditions.length > 0)

  if (next === undefined) {
    return null
  }

  const left = (type: TierCondition['type'], have: number): number | null => {
    const condition = next.conditions.find((candidate) => candidate.type === type)
    return condition === undefined ? null : Math.max(0, condition.gt + 1 - have)
  }

  const spentLeft = left('SPENT_TOTAL', facts.spentTotal)
  const visitsLeft = left('VISITS_TOTAL', facts.visitsTotal)

  return spentLeft === null && visitsLeft === null ? null : { next, spentLeft, visitsLeft }
}
