import { STAFF_REWARD_MAX, STAFF_REWARD_PCT_MAX, STAFF_SHIFT_CAP_MAX } from '@positive/contracts'
import type { StaffRewardBasis, StaffRewardSettings } from '@positive/contracts'

/**
 * Черновик доплаты кассирам: что набрано в полях и что из этого можно сохранить.
 * docs/03, раздел 6.
 *
 * ДЕНЬГИ В БАТАХ, ПРОЦЕНТ — ПРОЦЕНТОМ. Владелец думает «100 ฿ за гостя» и «5%
 * от чека»; в минорные единицы это переводится здесь, на границе, а не в форме
 * и не на сервере. Смысл поля задаёт база начисления — поэтому и перевод разный.
 *
 * ЧИСТЫЕ ФУНКЦИИ БЕЗ REACT. Ошибка в переводе сотой доли — это ошибка в зарплате
 * кассира: такое проверяется таблицей значений, а не кликами по форме.
 */

export interface StaffRewardDraft {
  readonly enabled: boolean
  readonly basis: StaffRewardBasis
  /** Как набрано в поле: «100» или «5». Пустая строка — поле очистили. */
  readonly value: string
  readonly vesting: StaffRewardSettings['vesting']
  readonly shiftCap: string
}

export type StaffRewardProblem = 'value' | 'shiftCap'

export type StaffRewardCheck =
  | { readonly ok: true; readonly settings: StaffRewardSettings }
  | { readonly ok: false; readonly problem: StaffRewardProblem }

/** Фиксированная награда хранится в сатангах, процент — как есть. */
const isFixed = (basis: StaffRewardBasis): boolean => basis === 'PER_NEW_GUEST'

export const toStaffRewardDraft = (settings: StaffRewardSettings): StaffRewardDraft => ({
  enabled: settings.enabled,
  basis: settings.basis,
  value: isFixed(settings.basis)
    ? String(Math.round(settings.value) / 100)
    : String(settings.value),
  vesting: settings.vesting,
  shiftCap: String(settings.shiftCap),
})

const number = (raw: string): number | null => {
  const trimmed = raw.trim().replace(',', '.')

  if (trimmed === '') {
    return null
  }

  const parsed = Number(trimmed)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export const fromStaffRewardDraft = (draft: StaffRewardDraft): StaffRewardCheck => {
  const cap = number(draft.shiftCap)

  if (cap === null || !Number.isInteger(cap) || cap > STAFF_SHIFT_CAP_MAX) {
    return { ok: false, problem: 'shiftCap' }
  }

  // Выключенную доплату сохраняем как есть: настраивать то, что не работает,
  // незачем, а обнулять набранное при выключении — терять работу владельца.
  if (!draft.enabled) {
    return {
      ok: true,
      settings: {
        enabled: false,
        basis: draft.basis,
        value: 0,
        vesting: draft.vesting,
        shiftCap: cap,
      },
    }
  }

  const raw = number(draft.value)

  if (raw === null || raw <= 0) {
    return { ok: false, problem: 'value' }
  }

  const value = isFixed(draft.basis) ? Math.round(raw * 100) : raw
  const limit = isFixed(draft.basis) ? STAFF_REWARD_MAX : STAFF_REWARD_PCT_MAX

  if (value > limit) {
    return { ok: false, problem: 'value' }
  }

  return {
    ok: true,
    settings: {
      enabled: true,
      basis: draft.basis,
      value,
      vesting: draft.vesting,
      shiftCap: cap,
    },
  }
}

/**
 * Во сколько обойдётся доплата — владельцу до того, как он её включит.
 *
 * Считается от того, что уже происходит: сколько чеков и сколько новых гостей
 * было за период. Обещать «примерно» без этих чисел бессмысленно — заведение
 * с двадцатью чеками в день и с двумястами платит разное.
 */
export interface RewardForecastFacts {
  /** Чеков за период. */
  readonly receipts: number
  /** Из них новых гостей. */
  readonly newGuests: number
  /** Оборот за период в минорных единицах. */
  readonly turnover: number
  /** Начислено баллов за период, в минорных единицах. */
  readonly pointsEarned: number
  /** Длина периода в днях. */
  readonly days: number
}

export interface RewardForecast {
  /** Сколько выйдет в день, в минорных единицах. */
  readonly perDay: number
  /** Сколько выйдет за месяц. */
  readonly perMonth: number
  /** Доля от оборота, процентом с одним знаком. null — оборота не было. */
  readonly pctOfTurnover: number | null
}

export const forecastReward = (
  settings: StaffRewardSettings,
  facts: RewardForecastFacts,
): RewardForecast => {
  if (!settings.enabled || facts.days <= 0) {
    return { perDay: 0, perMonth: 0, pctOfTurnover: null }
  }

  const total =
    settings.basis === 'PER_NEW_GUEST'
      ? facts.newGuests * settings.value
      : settings.basis === 'PCT_OF_POINTS'
        ? Math.floor((facts.pointsEarned * settings.value) / 100)
        : Math.floor((facts.turnover * settings.value) / 100)

  const perDay = Math.round(total / facts.days)

  return {
    perDay,
    perMonth: perDay * 30,
    pctOfTurnover: facts.turnover === 0 ? null : Math.round((total / facts.turnover) * 1000) / 10,
  }
}
