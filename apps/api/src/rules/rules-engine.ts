import {
  ENGINE_OFFER_TYPES,
  OfferAudience,
  OfferLimits,
  OfferReward,
  OfferSchedule,
  REWARD_OF_TYPE,
} from '@positive/contracts'
import type {
  AppliedOffer,
  EngineOfferType,
  OfferSkipReason,
  SkippedOffer,
} from '@positive/contracts'

/**
 * Движок правил акций. docs/01, раздел 4.5.
 *
 * На каждом предрасчёте кассы: собрать применимые акции, отсортировать
 * по приоритету, применить по очереди. Нестекируемая акция обрывает цепочку.
 * Результат — объяснимый список: что применилось и почему не применилось
 * остальное. Это кассир говорит гостю, и это разбирают в спорном случае.
 *
 * ЧИСТЫЕ ФУНКЦИИ БЕЗ БАЗЫ. Движок получает акции, счётчики выдач и факты
 * о госте, а возвращает решение. Так он проверяется на границах — «ровно
 * 800 ฿», «16:59 и 17:00», «пятый промокод из пяти» — без полигона.
 *
 * ОДНА ПРИЧИНА НА АКЦИЮ — ПЕРВАЯ НЕПРОЙДЕННАЯ. Порядок проверок — от «акция
 * вообще не про сейчас» к «не хватило суммы»: кассиру полезнее услышать
 * «акция по будням», чем «нужен чек от 800 ฿», если сегодня суббота.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Битая таймзона в данных не должна ронять кассу: все заведения сети — в этом поясе. */
const FALLBACK_TIMEZONE = 'Asia/Bangkok'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface RuleGuest {
  /** Первый визит в это заведение. */
  readonly isNew: boolean
  readonly mode: 'TOURIST' | 'RESIDENT'
  readonly lastVisitAt: Date | null
  /**
   * Контрольная группа: без начислений и без акций. Иначе нечем доказать,
   * что программа вообще что-то меняет (docs/01, раздел 4.2).
   */
  readonly isControlGroup: boolean
}

export interface RuleContext {
  /** Сумма чека. */
  readonly amount: number
  /** Оплачено деньгами — после списания баллов. От неё считается кэшбэк. */
  readonly amountToPay: number
  readonly at: Date
  readonly timezone: string
  readonly guest: RuleGuest
}

export interface OfferCandidate {
  readonly id: string
  readonly type: string
  readonly priority: number
  readonly stackable: boolean
  readonly title: string | null
  readonly audience: unknown
  readonly schedule: unknown
  readonly limits: unknown
  readonly reward: unknown
  /** Сколько промокодов этой акции уже выдано — всего и этому гостю. */
  readonly issued: { readonly total: number; readonly toGuest: number }
}

/** Применённая акция и то, что понадобится проведению чека. */
export interface EngineApplied extends AppliedOffer {
  /** Сколько дней живёт промокод; null — акция без промокода. */
  readonly grantValidityDays: number | null
}

export interface RulesOutcome {
  readonly applied: EngineApplied[]
  readonly skipped: SkippedOffer[]
  /** Баллов сверх базовой ставки по всем применённым акциям. */
  readonly earnDelta: number
}

type Effect = Pick<
  EngineApplied,
  'earnDelta' | 'discountDelta' | 'grantAfterPayment' | 'grantValidityDays'
>

type Verdict =
  | { readonly kind: 'SKIP'; readonly reason: OfferSkipReason; readonly message: string }
  | { readonly kind: 'APPLY'; readonly effect: Effect }

export const evaluateOffers = (
  offers: readonly OfferCandidate[],
  context: RuleContext,
): RulesOutcome => {
  // Сортировка устойчивая: при равном приоритете остаётся порядок, в котором
  // акции пришли, — вызывающий отдаёт их от старых к новым.
  const ordered = [...offers].sort((a, b) => a.priority - b.priority)
  const applied: EngineApplied[] = []
  const skipped: SkippedOffer[] = []
  let chainClosed = false

  for (const offer of ordered) {
    const verdict = judge(offer, context)

    if (verdict.kind === 'SKIP') {
      skipped.push({
        offerId: offer.id,
        title: offer.title,
        reason: verdict.reason,
        message: verdict.message,
      })
      continue
    }

    // Не применившаяся акция цепочку не обрывает: обрывает только та,
    // которая действительно легла в чек.
    if (chainClosed) {
      skipped.push({
        offerId: offer.id,
        title: offer.title,
        reason: 'NOT_STACKABLE',
        message: 'Не суммируется с акцией выше',
      })
      continue
    }

    applied.push({ offerId: offer.id, title: offer.title, ...verdict.effect })
    chainClosed = !offer.stackable
  }

  return {
    applied,
    skipped,
    earnDelta: applied.reduce((sum, offer) => sum + offer.earnDelta, 0),
  }
}

const skip = (reason: OfferSkipReason, message: string): Verdict => ({
  kind: 'SKIP',
  reason,
  message,
})

const judge = (offer: OfferCandidate, context: RuleContext): Verdict => {
  const rules = parseRules(offer)

  if (rules === null) {
    return skip('MISCONFIGURED', 'Акция настроена с ошибкой — её надо поправить в бэк-офисе')
  }

  if (context.guest.isControlGroup) {
    return skip('CONTROL_GROUP', 'Гость в контрольной группе: акции к нему не применяются')
  }

  const { audience, schedule, limits, reward } = rules
  const local = localParts(context.at, context.timezone)

  if (schedule.startsAt !== undefined && context.at.getTime() < Date.parse(schedule.startsAt)) {
    return skip(
      'SCHEDULE',
      `Акция начнётся ${localDate(new Date(schedule.startsAt), context.timezone)}`,
    )
  }

  if (schedule.endsAt !== undefined && context.at.getTime() > Date.parse(schedule.endsAt)) {
    return skip('SCHEDULE', 'Акция уже закончилась')
  }

  if (schedule.weekdays !== undefined && !schedule.weekdays.includes(local.weekday)) {
    return skip('SCHEDULE', 'Сегодня акция не действует — только в свои дни недели')
  }

  if (schedule.timeWindow !== undefined && !inWindow(local.minutes, schedule.timeWindow)) {
    return skip(
      'TIME_WINDOW',
      `Действует с ${schedule.timeWindow.from} до ${schedule.timeWindow.to}`,
    )
  }

  const audienceMiss = missesAudience(audience, context)

  if (audienceMiss !== null) {
    return skip('AUDIENCE', audienceMiss)
  }

  if (reward.kind === 'GIFT_CODE') {
    if (present(limits.perGuestQty) && offer.issued.toGuest >= limits.perGuestQty) {
      return skip('LIMIT_REACHED', 'Гость уже получал эту акцию')
    }

    if (present(limits.totalQty) && offer.issued.total >= limits.totalQty) {
      return skip('LIMIT_REACHED', 'Акция разобрана: все промокоды выданы')
    }
  }

  if (present(limits.minCheck) && context.amount < limits.minCheck) {
    return skip(
      'MIN_CHECK',
      `Нужен чек от ${baht(limits.minCheck)} — сейчас ${baht(context.amount)}`,
    )
  }

  return reward.kind === 'EARN_PERCENT'
    ? {
        kind: 'APPLY',
        effect: {
          // Кэшбэк — от уплаченного деньгами, как и базовая ставка: начислять
          // на часть, оплаченную баллами, значит платить проценты на свой долг.
          earnDelta: Math.floor((context.amountToPay * reward.percent) / 100),
          discountDelta: 0,
          grantAfterPayment: false,
          grantValidityDays: null,
        },
      }
    : {
        kind: 'APPLY',
        effect: {
          earnDelta: 0,
          discountDelta: 0,
          grantAfterPayment: true,
          grantValidityDays: reward.validityDays,
        },
      }
}

const parseRules = (
  offer: OfferCandidate,
): {
  audience: OfferAudience
  schedule: OfferSchedule
  limits: OfferLimits
  reward: OfferReward
} | null => {
  if (!isEngineType(offer.type)) {
    return null
  }

  const audience = OfferAudience.safeParse(offer.audience)
  const schedule = OfferSchedule.safeParse(offer.schedule)
  const limits = OfferLimits.safeParse(offer.limits)
  const reward = OfferReward.safeParse(offer.reward)

  if (!audience.success || !schedule.success || !limits.success || !reward.success) {
    return null
  }

  // Кэшбэк с промокодом вместо процента — не «сработает как-нибудь», а ошибка
  // настройки: кассир обязан узнать о ней, а не гость — о пустом кошельке.
  if (REWARD_OF_TYPE[offer.type] !== reward.data.kind) {
    return null
  }

  return {
    audience: audience.data,
    schedule: schedule.data,
    limits: limits.data,
    reward: reward.data,
  }
}

const isEngineType = (type: string): type is EngineOfferType =>
  (ENGINE_OFFER_TYPES as readonly string[]).includes(type)

const missesAudience = (audience: OfferAudience, context: RuleContext): string | null => {
  const { guest } = context

  switch (audience.kind) {
    case 'ALL':
      return null
    case 'NEW':
      return guest.isNew ? null : 'Только для первого визита'
    case 'TOURIST':
      return guest.mode === 'TOURIST' ? null : 'Только для туристов'
    case 'RESIDENT':
      return guest.mode === 'RESIDENT' ? null : 'Только для резидентов'
    case 'SLEEPING': {
      const asleep =
        guest.lastVisitAt !== null &&
        context.at.getTime() - guest.lastVisitAt.getTime() >= audience.notVisitedDays * DAY_MS

      return asleep ? null : `Для тех, кто не был больше ${String(audience.notVisitedDays)} дней`
    }
  }
}

const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined

/** Минуты от полуночи и день недели (1 — понедельник) по часам заведения. */
const localParts = (at: Date, timezone: string): { weekday: number; minutes: number } => {
  const read = (zone: string): { weekday: number; minutes: number } => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''

    return {
      weekday: WEEKDAYS.indexOf(value('weekday')) + 1,
      minutes: Number(value('hour')) * 60 + Number(value('minute')),
    }
  }

  try {
    return read(timezone)
  } catch {
    return read(FALLBACK_TIMEZONE)
  }
}

const localDate = (date: Date, timezone: string): string => {
  const format = (zone: string): string =>
    new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit' }).format(
      date,
    )

  try {
    return format(timezone)
  } catch {
    return format(FALLBACK_TIMEZONE)
  }
}

const clockMinutes = (value: string): number =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

/** Полуоткрытое окно [с, до). Окно через полночь — «с 22:00 до 02:00» — два отрезка. */
const inWindow = (minutes: number, window: { from: string; to: string }): boolean => {
  const start = clockMinutes(window.from)
  const end = clockMinutes(window.to)

  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/** Деньги словами для кассира: «800 ฿», «799.99 ฿». Сатанги — только если они есть. */
const baht = (minor: number): string => {
  const whole = Math.floor(minor / 100)
  const rest = minor % 100

  return `${String(whole)}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`} ฿`
}
