import type { TierInput, TierSettings } from '@positive/contracts'

/**
 * Лестница статусов в форме настроек и её перевод в то, что сохраняет сервер.
 * docs/02, раздел 5.6.1 · docs/11, У3.
 *
 * ПОЛЯ — СТРОКИ. «5,5» в процессе набора бывает «5,», а пустой порог — это
 * «без условия», а не ноль.
 *
 * ПОРОГ ОБОРОТА И ПРИВЕТСТВЕННЫЕ БАЛЛЫ — В БАТАХ НА ЭКРАНЕ, В САТАНГАХ НА СЕРВЕРЕ.
 * Перевод — здесь и больше нигде (железное правило 4).
 *
 * НОВЫЙ СТАТУС ПОЛУЧАЕТ ID ПРИ СОХРАНЕНИИ: `tier-1`, `tier-2`… — первый свободный.
 * Название в id не превращаем: id живёт в участиях гостей, и переименование
 * статуса не должно его менять.
 *
 * У СКРЫТОГО СТАТУСА УСЛОВИЙ НЕТ. Он назначается только руками, и условия,
 * сохранённые при нём, выглядели бы обещанием, которое касса не исполнит.
 */

export const TIERS_LIMIT = 10

/** 10 000 ฿ — потолок приветственных баллов, как на сервере. */
export const WELCOME_LIMIT_MINOR = 1_000_000

export interface TierRowDraft {
  /** Ключ строки в форме. У сохранённого статуса совпадает с id. */
  readonly key: string
  /** id сохранённого статуса; null — новый, id выдаётся при сохранении. */
  readonly id: string | null
  readonly name: string
  readonly earnRate: string
  readonly redeemRate: string
  readonly hidden: boolean
  /** Оборот больше, баты. Пусто — без условия. */
  readonly spentOver: string
  readonly visitsOver: string
  readonly referralsOver: string
}

export interface TierDraft {
  readonly tiers: readonly TierRowDraft[]
  readonly welcomeEnabled: boolean
  /** Баты. */
  readonly welcomeAmount: string
  readonly welcomeTrigger: TierSettings['welcomeBonus']['trigger']
}

export type TierRowField =
  'name' | 'earnRate' | 'redeemRate' | 'spentOver' | 'visitsOver' | 'referralsOver'

export type TierProblem =
  | { readonly kind: 'row'; readonly row: number; readonly field: TierRowField }
  | { readonly kind: 'duplicateName' }
  | { readonly kind: 'tooMany' }
  | { readonly kind: 'welcomeAmount' }

export type TierCheck =
  | { readonly ok: true; readonly settings: TierSettings }
  | { readonly ok: false; readonly problem: TierProblem }

type ConditionType = TierInput['conditions'][number]['type']

const blank = (value: string): boolean => value.trim() === ''

/** «5», «5,5», «12500.50». Минус и мусор — null. */
const decimal = (value: string): number | null => {
  const trimmed = value.trim().replace(',', '.')
  return /^\d{1,7}(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : null
}

const whole = (value: string): number | null => {
  const trimmed = value.trim()
  return /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : null
}

const bahtText = (minor: number): string => String(minor / 100)

const freeId = (taken: ReadonlySet<string>): string => {
  let number = 1

  while (taken.has(`tier-${String(number)}`)) {
    number += 1
  }

  return `tier-${String(number)}`
}

export const newRow = (key: string): TierRowDraft => ({
  key,
  id: null,
  name: '',
  earnRate: '',
  redeemRate: '',
  hidden: false,
  spentOver: '',
  visitsOver: '',
  referralsOver: '',
})

export const toDraft = (settings: TierSettings): TierDraft => ({
  tiers: settings.tiers.map((tier) => {
    const over = (type: ConditionType): number | undefined =>
      tier.conditions.find((condition) => condition.type === type)?.gt

    const spent = over('SPENT_TOTAL')
    const visits = over('VISITS_TOTAL')
    const referrals = over('REFERRALS')

    return {
      key: tier.id,
      id: tier.id,
      name: tier.name,
      earnRate: String(tier.earnRate),
      redeemRate: String(tier.redeemRate),
      hidden: tier.hidden,
      spentOver: spent === undefined ? '' : bahtText(spent),
      visitsOver: visits === undefined ? '' : String(visits),
      referralsOver: referrals === undefined ? '' : String(referrals),
    }
  }),
  welcomeEnabled: settings.welcomeBonus.enabled,
  welcomeAmount: settings.welcomeBonus.amount === 0 ? '' : bahtText(settings.welcomeBonus.amount),
  welcomeTrigger: settings.welcomeBonus.trigger,
})

/** Первая проблема — по порядку полей на экране; нет проблем — то, что уйдёт на сервер. */
export const fromDraft = (draft: TierDraft): TierCheck => {
  const fail = (problem: TierProblem): TierCheck => ({ ok: false, problem })

  if (draft.tiers.length > TIERS_LIMIT) {
    return fail({ kind: 'tooMany' })
  }

  const taken = new Set(draft.tiers.flatMap((row) => (row.id === null ? [] : [row.id])))
  const tiers: TierInput[] = []

  for (const [index, row] of draft.tiers.entries()) {
    const rowFail = (field: TierRowField): TierCheck => fail({ kind: 'row', row: index, field })

    const name = row.name.trim()

    if (name === '' || name.length > 40) {
      return rowFail('name')
    }

    const earnRate = decimal(row.earnRate)

    if (earnRate === null || earnRate > 50) {
      return rowFail('earnRate')
    }

    const redeemRate = decimal(row.redeemRate)

    if (redeemRate === null || redeemRate > 100) {
      return rowFail('redeemRate')
    }

    const conditions: TierInput['conditions'] = []

    if (!row.hidden) {
      if (!blank(row.spentOver)) {
        const baht = decimal(row.spentOver)

        if (baht === null) {
          return rowFail('spentOver')
        }

        conditions.push({ type: 'SPENT_TOTAL', gt: Math.round(baht * 100) })
      }

      if (!blank(row.visitsOver)) {
        const visits = whole(row.visitsOver)

        if (visits === null) {
          return rowFail('visitsOver')
        }

        conditions.push({ type: 'VISITS_TOTAL', gt: visits })
      }

      if (!blank(row.referralsOver)) {
        const referrals = whole(row.referralsOver)

        if (referrals === null) {
          return rowFail('referralsOver')
        }

        conditions.push({ type: 'REFERRALS', gt: referrals })
      }
    }

    const id = row.id ?? freeId(taken)
    taken.add(id)
    tiers.push({ id, name, earnRate, redeemRate, hidden: row.hidden, conditions })
  }

  const names = tiers.map((tier) => tier.name.toLowerCase())

  if (new Set(names).size !== names.length) {
    return fail({ kind: 'duplicateName' })
  }

  const baht = blank(draft.welcomeAmount) ? 0 : decimal(draft.welcomeAmount)
  const amount = baht === null ? null : Math.round(baht * 100)

  if (amount === null || amount > WELCOME_LIMIT_MINOR || (draft.welcomeEnabled && amount === 0)) {
    return fail({ kind: 'welcomeAmount' })
  }

  return {
    ok: true,
    settings: {
      tiers,
      welcomeBonus: { enabled: draft.welcomeEnabled, amount, trigger: draft.welcomeTrigger },
    },
  }
}
