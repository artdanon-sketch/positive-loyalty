import { z } from 'zod'

/**
 * Застрявшие чеки. docs/10, разделы 5.7 и 6.10 · docs/02, раздел 3.6.
 *
 * Очередь отложенных чеков живёт на планшете, и владелец о ней не знает.
 * Планшет присылает снимок своей очереди, владелец видит чеки, по которым гости
 * ещё без баллов. Сервер по снимку ничего не проводит — проведёт планшет тем же
 * ключом идемпотентности, когда появится связь.
 */

/**
 * Сколько попыток касса делает, прежде чем признать чек застрявшим.
 * Одна правда для планшета и сервера: разойдись они — владелец видел бы
 * «застрял» там, где касса ещё пробует, или наоборот.
 */
export const POS_QUEUE_MAX_ATTEMPTS = 20

/** Больше двухсот чеков в очереди не бывает у живой кассы — это уже поломка. */
export const POS_QUEUE_REPORT_MAX = 200

/** Чек, не дошедший за час, владелец видит, даже если попытки ещё не кончились. */
export const POS_QUEUE_LATE_AFTER_MINUTES = 60

/** Случайная метка браузера планшета: какой именно это планшет. */
export const TerminalId = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/)

/** Кого начислять — как лежит в очереди: найденный участник или набранный телефон. */
export const PosQueueTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MEMBERSHIP'), membershipId: z.uuid() }).strict(),
  z.object({ kind: z.literal('PHONE'), phone: z.string().trim().min(4).max(32) }).strict(),
])

export type PosQueueTarget = z.infer<typeof PosQueueTarget>

export const PosQueueReportItem = z
  .object({
    /** Ключ идемпотентности чека — тот же, с которым он уйдёт на сервер. */
    receiptId: z.string().trim().min(1).max(64),
    /** Сумма чека в сатангах. */
    amount: z.number().int().positive().max(2_147_483_647),
    receiptNumber: z.string().trim().min(1).max(64).optional(),
    target: PosQueueTarget,
    attempts: z.number().int().min(0).max(1_000_000),
    /** Последняя причина неудачи, как её видит кассир. */
    lastError: z.string().max(300).optional(),
    queuedAt: z.iso.datetime(),
  })
  .strict()

export type PosQueueReportItem = z.infer<typeof PosQueueReportItem>

/** Снимок очереди одного планшета. Пустой список — «у меня ничего не лежит». */
export const PosQueueReport = z
  .object({
    terminalId: TerminalId,
    items: z.array(PosQueueReportItem).max(POS_QUEUE_REPORT_MAX),
  })
  .strict()

export type PosQueueReport = z.infer<typeof PosQueueReport>

export const PosQueueReportResult = z.object({ tracked: z.number().int().nonnegative() }).strict()
export type PosQueueReportResult = z.infer<typeof PosQueueReportResult>

/** Чек, который не дошёл, — глазами владельца. */
export const StuckReceipt = z
  .object({
    receiptId: z.string(),
    /** Сатанги. */
    amount: z.number().int(),
    receiptNumber: z.string().nullable(),
    /** Имя гостя, а если его нет — маска телефона. */
    guest: z.string().nullable(),
    /** Кто был в смене, когда планшет прислал снимок. */
    staffName: z.string().nullable(),
    /** Последние знаки метки планшета: «…a1b2». */
    terminal: z.string(),
    attempts: z.number().int().nonnegative(),
    /** Попытки исчерпаны или сервер отказал: сам чек не уйдёт никогда. */
    stuck: z.boolean(),
    lastError: z.string().nullable(),
    queuedAt: z.iso.datetime(),
    /** Когда планшет последний раз выходил на связь с этим чеком. */
    reportedAt: z.iso.datetime(),
  })
  .strict()

export type StuckReceipt = z.infer<typeof StuckReceipt>

/** Старые сверху: дольше всех без баллов ждёт гость первой строки. */
export const StuckReceiptList = z.object({ items: z.array(StuckReceipt) }).strict()
export type StuckReceiptList = z.infer<typeof StuckReceiptList>
