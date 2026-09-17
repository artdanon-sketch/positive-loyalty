import type { GuestHistoryEntry, LedgerType } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n/dictionaries'

/**
 * Как показать одну строку истории. docs/02, раздел 2.11.
 *
 * ГОСТЮ НУЖНО «ЗА ЧТО», А НЕ «КАКОГО ТИПА ЗАПИСЬ». `EARN` и `REVERSAL` —
 * наши слова; человек ждёт «Покупка» и «Чек отменён». Поэтому перевод типа
 * в человеческое лежит отдельно и проверяется тестом: строка «ADJUST» на карте
 * гостя выглядит как сбой, даже когда всё работает.
 *
 * ЗНАК ВАЖНЕЕ ЦВЕТА. Списание отличается от начисления минусом, а не только
 * оттенком: оттенок не виден на солнце у стойки и не читается вслух.
 */

export const HISTORY_LABEL: Readonly<Record<LedgerType, TranslationKey>> = {
  EARN: 'history.kind.earn',
  REDEEM: 'history.kind.redeem',
  EXPIRE: 'history.kind.expire',
  ADJUST: 'history.kind.adjust',
  REVERSAL: 'history.kind.reversal',
  GRANT: 'history.kind.grant',
}

/** Баллы со знаком: «+120», «−80». Ноль тоже бывает — у отмены без баллов. */
export const signedPoints = (points: number): string => {
  if (points > 0) {
    return `+${String(points)}`
  }

  // Минус берём типографский: дефис в этом месте читается как перенос.
  return points < 0 ? `−${String(Math.abs(points))}` : '0'
}

/** Знак операции для оформления строки. */
export const historyTone = (entry: GuestHistoryEntry): 'up' | 'down' | 'flat' =>
  entry.points > 0 ? 'up' : entry.points < 0 ? 'down' : 'flat'
