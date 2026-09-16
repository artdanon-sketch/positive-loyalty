import { z } from 'zod'

import { DashboardPeriod } from './admin.js'

/**
 * Безопасность заведения: история действий и подозрительные операции.
 * docs/02, раздел 5.13 · docs/05, разделы 6.1 и 9 · docs/11, У12.
 *
 * ИСТОРИЯ — БЕЗ ЗНАЧЕНИЙ «БЫЛО / СТАЛО». В аудите лежат и телефоны, и комментарии
 * к подаркам; владельцу на экране нужно «кто, что и когда», а разбор с полными
 * значениями — работа поддержки.
 *
 * ПОДОЗРИТЕЛЬНОЕ — ПОВОД ПОСМОТРЕТЬ, А НЕ ПРИГОВОР. Сервер ничего не блокирует:
 * ложное срабатывание в час пик стоит дороже пропущенной накрутки (docs/05, раздел 6.1).
 */

const Count = z.number().int().nonnegative()
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Настоящий день календаря: «2026-02-30» проходит проверку маской, но в базе станет
 * вторым марта. Сравнение с обратным преобразованием ловит такие подмены.
 */
const CalendarDay = LocalDate.refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}, 'Такого дня нет в календаре')

export const SECURITY_HISTORY_PAGE = 50

// ─── История действий ────────────────────────────────────────────────────────

export const SecurityHistoryQuery = z
  .object({
    /** Листание назад: события строго раньше этого момента. */
    before: z.iso.datetime().optional(),
    /** Одни сутки заведения, YYYY-MM-DD. Без него — вся история подряд. */
    day: CalendarDay.optional(),
    /** Только действия этого сотрудника. Чужой идентификатор просто ничего не найдёт. */
    actorId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(SECURITY_HISTORY_PAGE),
  })
  .strict()

export type SecurityHistoryQuery = z.infer<typeof SecurityHistoryQuery>

export const SecurityActorType = z.enum([
  'SYSTEM',
  'GUEST',
  'CASHIER',
  'MANAGER',
  'OWNER',
  'PLATFORM_ADMIN',
])
export type SecurityActorType = z.infer<typeof SecurityActorType>

export const SecurityEvent = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    /** Машиночитаемое действие из аудита: STAFF_CREATED, BALANCE_ADJUSTED, … */
    action: z.string().min(1),
    actorType: SecurityActorType,
    /** Сотрудник заведения, если действовал он. Поддержку платформы по имени не называем. */
    actor: z.object({ id: z.uuid(), displayName: z.string() }).strict().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict()

export type SecurityEvent = z.infer<typeof SecurityEvent>

export const SecurityHistory = z
  .object({
    items: z.array(SecurityEvent),
    /** Передать в `before`, чтобы получить страницу раньше. null — дальше пусто. */
    nextBefore: z.iso.datetime().nullable(),
  })
  .strict()

export type SecurityHistory = z.infer<typeof SecurityHistory>

// ─── Подозрительные операции ─────────────────────────────────────────────────

export const SuspiciousQuery = z
  .object({
    period: DashboardPeriod.default('7d'),
  })
  .strict()

export type SuspiciousQuery = z.infer<typeof SuspiciousQuery>

export const SuspiciousGuest = z
  .object({
    membershipId: z.uuid(),
    guestId: z.uuid(),
    displayName: z.string().nullable(),
    /** Целиком: экран безопасности — только владельца. */
    phone: z.string().nullable(),
    day: LocalDate,
    /** Неотменённых чеков за этот день. */
    receipts: Count,
  })
  .strict()

export type SuspiciousGuest = z.infer<typeof SuspiciousGuest>

/**
 * BURST — день, когда сотрудник провёл заметно больше обычного: выше среднего на три
 * стандартных отклонения (docs/05, раздел 9), не меньше десяти чеков и при истории
 * не короче недели. SELF_LINKED — чек на гостя с тем же номером телефона, что у сотрудника.
 */
export const CashierSignal = z.enum(['BURST', 'SELF_LINKED'])
export type CashierSignal = z.infer<typeof CashierSignal>

export const SuspiciousCashier = z
  .object({
    staffId: z.uuid(),
    displayName: z.string(),
    signal: CashierSignal,
    day: LocalDate,
    receipts: Count,
    /** Обычно чеков в день у этого сотрудника. null — у SELF_LINKED. */
    usual: z.number().nonnegative().nullable(),
  })
  .strict()

export type SuspiciousCashier = z.infer<typeof SuspiciousCashier>

export const SuspiciousReport = z
  .object({
    period: DashboardPeriod,
    /** Порог, по которому отобраны гости, — чтобы экран мог его назвать. */
    maxChecksPerDay: z.number().int(),
    guests: z.array(SuspiciousGuest),
    cashiers: z.array(SuspiciousCashier),
  })
  .strict()

export type SuspiciousReport = z.infer<typeof SuspiciousReport>
