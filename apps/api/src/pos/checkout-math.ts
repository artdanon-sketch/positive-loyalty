import type { ProgramMode } from '@positive/contracts'

/**
 * Арифметика чека: скидка, потолок оплаты баллами, сумма к оплате, баллы
 * по ставке. docs/02, раздел 3.2.
 *
 * Отдельной чистой функцией, а не строками внутри предрасчёта: здесь вся правда
 * о деньгах гостя, и проверять её тестом проще без базы и без кассы.
 *
 * ─── ДВА РЕЖИМА — ОДНА СТАВКА ──────────────────────────────────────────────
 *
 * CASHBACK: гость платит чек целиком, баллы приходят на следующий визит.
 * DISCOUNT: та же ставка вычитается из этого чека сразу, баллов с покупки нет.
 * Ставка одна — базовая или статуса, — и владелец, переключив режим, не
 * переписывает лестницу статусов: «Золото 7%» остаётся семью процентами.
 *
 * ─── ПОРЯДОК: СКИДКА, ПОТОМ БАЛЛЫ ───────────────────────────────────────────
 *
 * Скидка — от полной суммы; потолок оплаты баллами — доля того, что осталось
 * после скидки. Наоборот вышло бы, что баллами можно закрыть часть чека,
 * которую гость и так не платит.
 *
 * Округление везде вниз — в пользу заведения: баллы и скидка — его расходы.
 *
 * ─── КОГДА СКИДКИ НЕТ ──────────────────────────────────────────────────────
 *
 * Контрольной группе — ни скидки, ни баллов: на ней держится доказательство
 * эффекта программы (docs/01, раздел 4.2).
 *
 * `withoutDiscount` — чек уже оплачен целиком, кассир скидки не видел (офлайн-
 * очередь). Тогда вместо скидки — баллы по той же ставке, как в CASHBACK:
 * не дать ни того, ни другого значило бы наказать гостя за пропавшую сеть.
 */
export interface CheckoutFacts {
  readonly amount: number
  readonly redeemRequested: number
  readonly balance: number
  readonly earnRate: number
  readonly redeemRate: number
  readonly mode: ProgramMode
  readonly isControlGroup: boolean
  readonly withoutDiscount: boolean
}

export interface Checkout {
  readonly discount: number
  readonly maxRedeemable: number
  readonly redeem: number
  readonly amountToPay: number
  /** Баллы по ставке — без акций: кэшбэк акций предрасчёт добавляет сверху. */
  readonly basePoints: number
}

export const checkout = (facts: CheckoutFacts): Checkout => {
  const discounts = facts.mode === 'DISCOUNT' && !facts.isControlGroup && !facts.withoutDiscount
  const discount = discounts ? Math.floor((facts.amount * facts.earnRate) / 100) : 0
  const due = facts.amount - discount

  const rateCap = Math.floor((due * facts.redeemRate) / 100)
  const maxRedeemable = Math.max(0, Math.min(rateCap, facts.balance))
  const redeem = Math.max(0, Math.min(facts.redeemRequested, maxRedeemable))
  const amountToPay = due - redeem

  // Начисляем от суммы, реально уплаченной деньгами: начислять на часть,
  // оплаченную баллами, значит платить проценты на собственный долг.
  const basePoints =
    facts.isControlGroup || discounts ? 0 : Math.floor((amountToPay * facts.earnRate) / 100)

  return { discount, maxRedeemable, redeem, amountToPay, basePoints }
}
