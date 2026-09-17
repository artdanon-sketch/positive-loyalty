import type { StaffRewardConfig } from '@positive/contracts'

/**
 * Сколько заведение должно кассиру за этот чек — и должно ли вообще.
 * docs/03, раздел 6 · docs/05, раздел 6.1.
 *
 * ЧИСТАЯ ФУНКЦИЯ БЕЗ БАЗЫ. Правила, по которым НЕ платят, — это антифрод,
 * и проверяться они обязаны построчно: «свой номер», «отменённый чек»,
 * «повторный гость» и «сверх лимита смены» стоят денег владельца каждый раз,
 * когда ошибаются.
 *
 * ВЛАДЕЛЕЦ НЕ МОЖЕТ ИХ ОТКЛЮЧИТЬ (docs/03, раздел 6: «не даём отключить
 * антифрод-правила мотивации»). Доплата без них — премия за накрутку,
 * а мы — соучастник.
 */

/** Почему не заплатили. Строка уходит в отчёт сотруднику, поэтому она человеческая. */
export type RewardRefusal =
  | 'Доплата выключена в настройках'
  | 'Чек на гостя с номером самого сотрудника'
  | 'Гость не новый, а платим только за новых'
  | 'Достигнут лимит наград за смену'
  | 'Нулевая награда при таких настройках'

export interface RewardFacts {
  /** Начислено баллов гостю по этому чеку, в минорных единицах. */
  readonly pointsEarned: number
  /** Сумма чека в минорных единицах. null — чек без суммы. */
  readonly basisAmount: number | null
  /** Первый ли это неотменённый чек гостя в заведении. */
  readonly isNewGuest: boolean
  /** Совпадает ли телефон гостя с телефоном сотрудника. */
  readonly selfLinked: boolean
  /** Сколько наград сотрудник уже получил за смену. */
  readonly rewardsThisShift: number
}

export type RewardDecision =
  | { readonly paid: true; readonly amount: number }
  | { readonly paid: false; readonly reason: RewardRefusal }

const percent = (value: number, rate: number): number => Math.floor((value * rate) / 100)

export function decideStaffReward(config: StaffRewardConfig, facts: RewardFacts): RewardDecision {
  if (!config.enabled || config.value <= 0) {
    return { paid: false, reason: 'Доплата выключена в настройках' }
  }

  // Чек на свой же номер — первое, что проверяем: это самая частая накрутка
  // (docs/05, раздел 9, сигнал SELF_LINKED), и платить за неё нельзя ни по какой базе.
  if (facts.selfLinked) {
    return { paid: false, reason: 'Чек на гостя с номером самого сотрудника' }
  }

  // Лимит смены — потолок, а не повод «доплатить в следующий раз»: награда
  // сверх него не откладывается, иначе потолок перестаёт быть потолком.
  if (facts.rewardsThisShift >= config.shiftCap) {
    return { paid: false, reason: 'Достигнут лимит наград за смену' }
  }

  if (config.basis === 'PER_NEW_GUEST') {
    // Платим за приведённого человека, а не за оформление. Постоянный гость
    // сканирует код сам — доплачивать за него не за что (docs/03, раздел 6).
    if (!facts.isNewGuest) {
      return { paid: false, reason: 'Гость не новый, а платим только за новых' }
    }

    return { paid: true, amount: Math.floor(config.value) }
  }

  const amount =
    config.basis === 'PCT_OF_POINTS'
      ? percent(facts.pointsEarned, config.value)
      : percent(facts.basisAmount ?? 0, config.value)

  // Ноль — это не награда: строка «заработал 0» в отчёте только путает.
  return amount > 0
    ? { paid: true, amount }
    : { paid: false, reason: 'Нулевая награда при таких настройках' }
}

/**
 * Дозревает ли награда сразу.
 *
 * `ON_SECOND_VISIT` — умолчание: пока гость не пришёл второй раз, нельзя
 * отличить приведённого человека от случайного прохожего.
 */
export const vestsImmediately = (config: StaffRewardConfig): boolean =>
  config.vesting === 'IMMEDIATE'
