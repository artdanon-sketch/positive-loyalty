import { z } from 'zod'

import { DashboardPeriod } from './admin.js'
import { RfmSegment } from './rfm.js'

/**
 * Отчёты заведения: клиенты, операции, RFM, сотрудники. docs/02, раздел 5.10 · docs/11, У8.
 *
 * Суммы — в минорных единицах, границы суток — по часам заведения, как в дашборде.
 * Отменённые чеки не считаются нигде: отчёт, который показывает выручку
 * по отменённому чеку, спорит с кассой.
 *
 * Период по умолчанию — месяц: у малого заведения неделя почти всегда шумная.
 */

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Count = z.number().int().nonnegative()
const Minor = z.number().int().nonnegative()

export const ReportQuery = z
  .object({
    period: DashboardPeriod.default('30d'),
  })
  .strict()

export type ReportQuery = z.infer<typeof ReportQuery>

// ─── Клиенты ─────────────────────────────────────────────────────────────────

export const CustomersReportDay = z
  .object({
    /** `YYYY-MM-DD` в часовом поясе заведения. */
    date: LocalDate,
    /** Вступили в этот день. */
    newGuests: Count,
    /** Впервые купили в этот день. */
    firstPurchases: Count,
  })
  .strict()

export type CustomersReportDay = z.infer<typeof CustomersReportDay>

export const CustomersReport = z
  .object({
    period: DashboardPeriod,
    /** Гостей заведения всего, на сегодня. */
    total: Count,
    /** Из них покупали хоть раз. */
    buyers: Count,
    /** Доля покупавших, в процентах. null — гостей нет, делить не на что. */
    buyersPct: z.number().nullable(),
    /** Вступили за период. */
    newGuests: Count,
    /** Впервые купили за период. */
    firstPurchases: Count,
    /** Туристы и резиденты среди всех гостей. */
    tourists: Count,
    residents: Count,
    /** Каждый день периода, включая пустые. */
    series: z.array(CustomersReportDay),
  })
  .strict()

export type CustomersReport = z.infer<typeof CustomersReport>

// ─── Операции ────────────────────────────────────────────────────────────────

export const OperationsReportDay = z
  .object({
    date: LocalDate,
    turnover: Minor,
    purchases: Count,
  })
  .strict()

export type OperationsReportDay = z.infer<typeof OperationsReportDay>

export const OperationsReport = z
  .object({
    period: DashboardPeriod,
    /** Оборот: сумма чеков гостей программы за период без отменённых. */
    turnover: Minor,
    /** Покупок — чеков без отменённых. */
    purchases: Count,
    /** Средний чек. null — покупок не было. */
    averageCheck: Minor.nullable(),
    /** Начислено баллов по чекам без отменённых. */
    earned: Minor,
    /** Оплачено баллами по чекам без отменённых. */
    redeemed: Minor,
    /** Отменённых чеков за период. */
    voided: Count,
    series: z.array(OperationsReportDay),
  })
  .strict()

export type OperationsReport = z.infer<typeof OperationsReport>

// ─── RFM ─────────────────────────────────────────────────────────────────────

export const RfmReportRow = z
  .object({
    segment: RfmSegment,
    /** Покупателей в сегменте. */
    guests: Count,
    /** Их покупок за всё время. */
    purchases: Count,
    /** Их средний чек. null — сегмент пуст. */
    averageCheck: Minor.nullable(),
    /** Их оборот за всё время. */
    turnover: Minor,
  })
  .strict()

export type RfmReportRow = z.infer<typeof RfmReportRow>

export const RfmReport = z
  .object({
    /** Гостей, покупавших хоть раз: только они и попадают в сегменты. */
    buyers: Count,
    /** Все десять сегментов в порядке RfmSegment, пустые — нулями. */
    segments: z.array(RfmReportRow),
  })
  .strict()

export type RfmReport = z.infer<typeof RfmReport>

// ─── Сотрудники ──────────────────────────────────────────────────────────────

export const StaffReportCounts = z
  .object({
    /** Проведено чеков без отменённых. */
    operations: Count,
    /** Их оборот. */
    turnover: Minor,
    /** Гостей, чей первый чек в заведении провёл этот сотрудник. */
    newGuests: Count,
    /** Отзывов на эти чеки. */
    reviews: Count,
    /** Средняя оценка по ним, до десятых. null — отзывов не было. */
    rating: z.number().min(1).max(5).nullable(),
  })
  .strict()

export type StaffReportCounts = z.infer<typeof StaffReportCounts>

/** Те же счётчики, что у строки «система», плюс сам сотрудник. */
export const StaffReportRow = StaffReportCounts.extend({
  staffId: z.uuid(),
  displayName: z.string(),
  role: z.enum(['CASHIER', 'MANAGER', 'OWNER']),
  isActive: z.boolean(),
}).strict()

export type StaffReportRow = z.infer<typeof StaffReportRow>

export const StaffReport = z
  .object({
    period: DashboardPeriod,
    /** Сотрудники с чеками за период, по обороту. */
    staff: z.array(StaffReportRow),
    /** Чеки без сотрудника: пришли вебхуком из кассы POSitive. */
    system: StaffReportCounts,
  })
  .strict()

export type StaffReport = z.infer<typeof StaffReport>
