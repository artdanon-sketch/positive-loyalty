import { z } from 'zod'

/**
 * Виды продаж заведения: что именно оно продаёт гостю.
 *
 * ЗАЧЕМ ЭТО ЕСТЬ. Партнёрство «купил абонемент — получи ролл в подарок»
 * невозможно построить на одной сумме: ужин на 5 000 ฿ и абонемент на 5 000 ฿
 * для журнала неотличимы, и ресторан-донор раздавал бы подарки за крупные
 * счета, которых не ждал.
 *
 * СПИСОК ВЕДЁТ САМО ЗАВЕДЕНИЕ. У студии танцев это «абонемент на 10 занятий»
 * и «разовое занятие», у проката — «сутки» и «неделя». Общий справочник
 * на всех означал бы, что каждый новый вид бизнеса ждёт нашего релиза,
 * чтобы начать работать.
 *
 * НЕ ЗАВИСИТ ОТ КАССЫ. Вид выбирает кассир, когда проводит начисление в нашем
 * приложении. Партнёру не нужен POSitive POS: у него своя касса для денег,
 * наше приложение — для лояльности.
 */

/** Название видит кассир в списке и партнёр в условии — оно должно быть читаемым. */
const SaleKindName = z.string().trim().min(1).max(80)

/** Вид продажи, как его отдаёт API. */
export const SaleKind = z
  .object({
    id: z.uuid(),
    name: SaleKindName,
    /** Порядок в списке у кассира: часто продаваемое — наверх. */
    sortOrder: z.number().int(),
    /** Выключенный вид кассиру не предлагается, но остаётся в журнале. */
    isActive: z.boolean(),
  })
  .strict()

export type SaleKind = z.infer<typeof SaleKind>

/** Завести новый вид продажи. */
export const CreateSaleKindInput = z
  .object({
    name: SaleKindName,
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict()

export type CreateSaleKindInput = z.infer<typeof CreateSaleKindInput>

/**
 * Изменить вид продажи.
 *
 * Удаления нет и не будет: вид, на который ссылается журнал, исчезнуть
 * не может — иначе по журналу нельзя разобрать ни отчёт, ни спор с гостем.
 * Ненужное выключается через `isActive`.
 */
export const UpdateSaleKindInput = z
  .object({
    name: SaleKindName.optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Нечего менять: не передано ни одного поля',
  })

export type UpdateSaleKindInput = z.infer<typeof UpdateSaleKindInput>
