import { SUSPICIOUS_CHECKS_MAX, SUSPICIOUS_CHECKS_MIN } from '@positive/contracts'

/**
 * Порог подозрительных чеков из поля ввода. docs/02, раздел 5.6.5 · docs/11, У12.
 *
 * Целое от 2 до 50 — как на сервере. Негодное — null: кнопка сохранения заперта,
 * под полем объяснение.
 */
export const parseThreshold = (value: string): number | null => {
  const trimmed = value.trim()

  if (!/^\d{1,2}$/.test(trimmed)) {
    return null
  }

  const number = Number(trimmed)

  return number >= SUSPICIOUS_CHECKS_MIN && number <= SUSPICIOUS_CHECKS_MAX ? number : null
}
