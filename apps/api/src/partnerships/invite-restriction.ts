import type { InviteRestriction } from '@positive/contracts'

/**
 * Автоохлаждение и приостановка приглашений. docs/07, раздел 6.2.
 *
 * Чистые функции без базы: «три отказа за неделю» — арифметика над датами,
 * и проверять её надо на границах окна, а не на полигоне.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Столько разных получателей должны отказать… */
export const COOLING_DECLINES = 3
/** …за столько дней, … */
export const COOLING_WINDOW_DAYS = 7
/** …чтобы на столько дней от третьего отказа… */
export const COOLING_DAYS = 30
/** …бесплатных приглашений в сутки осталось столько. */
export const COOLING_FREE_INVITES = 1

/** Столько неразобранных жалоб от разных заведений — и приглашать нельзя вовсе. */
export const SUSPEND_COMPLAINTS = 5

/** Насколько глубоко смотреть назад: охлаждение, начатое раньше, уже кончилось. */
export const DECLINES_LOOKBACK_MS = (COOLING_DAYS + COOLING_WINDOW_DAYS) * DAY_MS

export interface Decline {
  /** Кто отказал. */
  readonly from: string
  readonly at: Date
}

export type Restriction =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'COOLING'; readonly until: Date }
  | { readonly kind: 'SUSPENDED' }

/**
 * Когда кончается охлаждение; `null` — его нет.
 *
 * Окно скользит по отказам: каждый отказ, ставший третьим от разных получателей
 * за семь дней, назначает охлаждение на тридцать дней от себя — новая волна
 * отказов его продлевает.
 *
 * Один получатель, отказавший трижды, — один отказ. Долбить одно заведение
 * и так нельзя (месяц тишины), а правило «три отказа» — про разных.
 */
export const coolingUntil = (declines: readonly Decline[], now: Date): Date | null => {
  const sorted = [...declines].sort((a, b) => a.at.getTime() - b.at.getTime())
  let until = 0

  for (const [index, decline] of sorted.entries()) {
    const windowStart = decline.at.getTime() - COOLING_WINDOW_DAYS * DAY_MS
    const senders = new Set(
      sorted
        .slice(0, index + 1)
        .filter((earlier) => earlier.at.getTime() > windowStart)
        .map((earlier) => earlier.from),
    )

    if (senders.size >= COOLING_DECLINES) {
      until = Math.max(until, decline.at.getTime() + COOLING_DAYS * DAY_MS)
    }
  }

  return until > now.getTime() ? new Date(until) : null
}

/**
 * Итоговое ограничение. Приостановка сильнее охлаждения: заведению, на которое
 * пожаловались пятеро, одно приглашение в день — всё ещё слишком много.
 */
export const inviteRestriction = (input: {
  readonly declines: readonly Decline[]
  readonly openComplaints: number
  readonly now: Date
}): Restriction => {
  if (input.openComplaints >= SUSPEND_COMPLAINTS) {
    return { kind: 'SUSPENDED' }
  }

  const until = coolingUntil(input.declines, input.now)

  return until === null ? { kind: 'NONE' } : { kind: 'COOLING', until }
}

/** Сколько бесплатных приглашений в сутки остаётся при ограничении. */
export const freeInvitesUnder = (base: number, restriction: Restriction): number => {
  switch (restriction.kind) {
    case 'SUSPENDED':
      return 0
    case 'COOLING':
      return Math.min(base, COOLING_FREE_INVITES)
    case 'NONE':
      return base
  }
}

/** Как ограничение уходит наружу: `null` — ограничений нет. */
export const restrictionView = (restriction: Restriction): InviteRestriction | null => {
  switch (restriction.kind) {
    case 'SUSPENDED':
      return { kind: 'SUSPENDED' }
    case 'COOLING':
      return { kind: 'COOLING', until: restriction.until.toISOString() }
    case 'NONE':
      return null
  }
}
