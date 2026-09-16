import { SETUP_STEPS } from '@positive/contracts'
import type { SetupItem, SetupStep } from '@positive/contracts'

/**
 * Чеклист «настройте за 5 минут». docs/02, раздел 5.1.2 · docs/11, У11.
 *
 * Шаг сделан, когда в заведении есть то, ради чего он:
 * - программа сохранена владельцем хотя бы раз — в настройках есть процент начисления,
 *   а его туда пишет только сохранение (умолчания разбора в базу не попадают);
 * - есть включённый кассир;
 * - есть идущая или запланированная акция — подарки из карточки и шаблоны сертификатов
 *   не в счёт;
 * - есть включённый источник трафика.
 *
 * Чистая функция: правила проверяются юнит-тестом, а подсчёты — интеграционным.
 */

export interface SetupFacts {
  readonly settings: unknown
  readonly cashiers: number
  readonly offers: number
  readonly channels: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const setupChecklist = (facts: SetupFacts): SetupItem[] => {
  const done: Readonly<Record<SetupStep, boolean>> = {
    PROGRAM: isRecord(facts.settings) && 'baseEarnRate' in facts.settings,
    CASHIER: facts.cashiers > 0,
    OFFER: facts.offers > 0,
    CHANNEL: facts.channels > 0,
  }

  return SETUP_STEPS.map((step) => ({ step, done: done[step] }))
}
