import type {
  OfferAudience,
  OfferLimits,
  OfferReward,
  OfferSchedule,
  OfferSimulation,
} from '@positive/contracts'

import { evaluateOffers } from './rules-engine'

/**
 * Прогноз акции на своей истории. docs/10, раздел 5.3 · docs/02, раздел 5.3.
 *
 * «Если бы эта акция шла последние 30 дней» — буквально: чеки заведения за
 * тридцать дней прогоняются через ТОТ ЖЕ движок правил, что считает кассу.
 * Прогноз и касса не могут разойтись в трактовке порога, окна или лимита:
 * это один и тот же код.
 *
 * ДАТЫ АКЦИИ В ПРОГНОЗЕ НЕ УЧАСТВУЮТ. Акция «на завтра» по своим датам не шла
 * ни дня из прошедших тридцати — и прогноз честно показал бы ноль. Спрашивают
 * о другом: что было бы при таких условиях. Дни недели и окно времени — это
 * условия, они учитываются.
 *
 * ЧЕГО ПРОГНОЗ НЕ ЗНАЕТ И НЕ ПРИДУМЫВАЕТ. Сколько гостей вернётся по коду —
 * для этого нужны свои прошлые акции заведения, а не «средний по рынку».
 * Цену подарка вещью или процентом знает только заведение.
 *
 * ПОРОГ СРАВНИВАЕТСЯ С ОПЛАЧЕННЫМ ДЕНЬГАМИ: так чек лежит в журнале. Сумма,
 * списанная баллами, в историю не попадает, и прогноз слегка осторожнее кассы.
 */

export const SIMULATION_DAYS = 30

/** Меньше чеков за окно — прогноз случаен: пара больших ужинов перевешивает месяц. */
export const MIN_CHECKS_FOR_FORECAST = 20

const DAY_MS = 24 * 60 * 60 * 1000

/** Идентификатор для движка: прогнозируемой акции в базе ещё нет. */
const SIMULATED_OFFER_ID = '00000000-0000-4000-8000-000000000000'

export interface HistoryCheck {
  readonly guestId: string
  /** Оплачено деньгами. */
  readonly amount: number
  readonly at: Date
  readonly mode: 'TOURIST' | 'RESIDENT'
  readonly isControlGroup: boolean
  /** Первый чек гостя в заведении вообще, а не только в окне. */
  readonly isFirstVisit: boolean
  /** Предыдущий чек гостя — для «спящих». */
  readonly previousVisitAt: Date | null
}

export interface SimulatedOffer {
  readonly type: string
  readonly audience: OfferAudience
  readonly schedule: OfferSchedule
  readonly limits: OfferLimits
  readonly reward: OfferReward
}

export const simulateOffer = (input: {
  readonly offer: SimulatedOffer
  readonly checks: readonly HistoryCheck[]
  /** Первый чек заведения в программе; null — чеков не было. */
  readonly historyStartedAt: Date | null
  readonly now: Date
  readonly timezone: string
}): OfferSimulation => {
  const since = input.now.getTime() - SIMULATION_DAYS * DAY_MS

  if (input.historyStartedAt === null || input.historyStartedAt.getTime() > since) {
    return {
      insufficientData: true,
      reason: 'Заведение в программе меньше 30 дней — прогноз по неполной истории соврал бы',
    }
  }

  const window = input.checks
    .filter((check) => check.at.getTime() >= since && check.at.getTime() <= input.now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  if (window.length < MIN_CHECKS_FOR_FORECAST) {
    return {
      insufficientData: true,
      reason: `За 30 дней меньше ${String(MIN_CHECKS_FOR_FORECAST)} чеков — на такой истории прогноз случаен`,
    }
  }

  const { schedule } = input.offer
  const recurring: OfferSchedule = {
    ...(schedule.weekdays === undefined ? {} : { weekdays: schedule.weekdays }),
    ...(schedule.timeWindow === undefined ? {} : { timeWindow: schedule.timeWindow }),
  }

  const guests = new Set<string>()
  const perGuest = new Map<string, number>()
  let grants = 0
  let bonusPoints = 0

  for (const check of window) {
    const outcome = evaluateOffers(
      [
        {
          id: SIMULATED_OFFER_ID,
          type: input.offer.type,
          priority: 100,
          stackable: true,
          title: null,
          audience: input.offer.audience,
          schedule: recurring,
          limits: input.offer.limits,
          reward: input.offer.reward,
          issued: { total: grants, toGuest: perGuest.get(check.guestId) ?? 0 },
        },
      ],
      {
        amount: check.amount,
        amountToPay: check.amount,
        at: check.at,
        timezone: input.timezone,
        guest: {
          isNew: check.isFirstVisit,
          mode: check.mode,
          lastVisitAt: check.previousVisitAt,
          isControlGroup: check.isControlGroup,
        },
      },
    )

    const applied = outcome.applied[0]

    if (applied === undefined) {
      continue
    }

    guests.add(check.guestId)
    bonusPoints += applied.earnDelta

    if (applied.grantAfterPayment) {
      grants += 1
      perGuest.set(check.guestId, (perGuest.get(check.guestId) ?? 0) + 1)
    }
  }

  const { reward } = input.offer

  if (reward.kind === 'EARN_PERCENT') {
    return {
      insufficientData: false,
      days: SIMULATION_DAYS,
      guests: guests.size,
      grants: null,
      bonusPoints,
      // Балл — это сатанг скидки на будущем чеке: цена кэшбэка и есть его баллы.
      cost: bonusPoints,
    }
  }

  return {
    insufficientData: false,
    days: SIMULATION_DAYS,
    guests: guests.size,
    grants,
    bonusPoints: null,
    // Считаем, что погасят все коды: прогноз расхода обязан быть сверху, а не снизу.
    cost: reward.gift.kind === 'FIXED_OFF' ? grants * reward.gift.amount : null,
  }
}
