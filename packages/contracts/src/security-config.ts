import { z } from 'zod'

/**
 * Порог подозрительных чеков. docs/02, раздел 5.6.5 · docs/05, раздел 6.1 · docs/11, У12.
 *
 * Отдельным модулем от `security.ts`: порог лежит в `Tenant.settings` и разбирается
 * `ProgramConfig`, а отчёту нужен период из `admin.ts` — одним файлом они замкнули бы
 * импорты по кругу.
 */

export const SUSPICIOUS_CHECKS_MIN = 2
export const SUSPICIOUS_CHECKS_MAX = 50

const MaxChecksPerDay = z
  .number()
  .int()
  .min(SUSPICIOUS_CHECKS_MIN, `Порог — не меньше ${String(SUSPICIOUS_CHECKS_MIN)} чеков`)
  .max(SUSPICIOUS_CHECKS_MAX, `Порог — не больше ${String(SUSPICIOUS_CHECKS_MAX)} чеков`)

export const SuspiciousConfig = z
  .object({
    /** Больше стольких чеков у одного гостя за день — повод посмотреть. */
    maxChecksPerDay: MaxChecksPerDay.default(5),
  })
  .strict()

export type SuspiciousConfig = z.infer<typeof SuspiciousConfig>

/** Порог на экране владельца — то же, что в конфиге, но без умолчаний. */
export const SuspiciousSettings = z
  .object({
    maxChecksPerDay: MaxChecksPerDay,
  })
  .strict()

export type SuspiciousSettings = z.infer<typeof SuspiciousSettings>
