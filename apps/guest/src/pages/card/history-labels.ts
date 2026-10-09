import type { GuestHistoryEntry, LedgerType } from '@positive/contracts'

import { formatBaht } from '../../shared/format/baht'

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

/**
 * Баллы со знаком — в батах, как баланс над ними: «+39,50 ฿», «−25,00 ฿».
 * Голое «+3950» под балансом «39,50 ฿» читалось как другая валюта.
 * Ноль тоже бывает — у отмены без баллов.
 */
export const signedPoints = (points: number): string => {
  if (points > 0) {
    return `+${formatBaht(points)}`
  }

  // Минус берём типографский: дефис в этом месте читается как перенос.
  return points < 0 ? `−${formatBaht(Math.abs(points))}` : formatBaht(0)
}

/** Знак операции для оформления строки. */
export const historyTone = (entry: GuestHistoryEntry): 'up' | 'down' | 'flat' =>
  entry.points > 0 ? 'up' : entry.points < 0 ? 'down' : 'flat'
