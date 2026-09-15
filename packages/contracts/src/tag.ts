import { z } from 'zod'

/**
 * Теги гостей. docs/02, раздел 5.2.5 · docs/11, У5.
 *
 * Тег — пометка заведения для себя: «VIP», «аллергия», «блогер». Гость его
 * не видит, соседнее заведение — тоже. Справочник ведёт само заведение.
 */

/** Цвет — из токенов дизайн-системы, а не произвольный: тег читается в обеих темах. */
export const TagColor = z.enum(['slate', 'mint', 'sky', 'amber', 'rose', 'violet'])
export type TagColor = z.infer<typeof TagColor>

/** Больше полусотни тегов у малого заведения — это уже не пометки, а беспорядок. */
export const TAGS_MAX = 50

/** Двадцать тегов на одном госте — предел, после которого их никто не читает. */
export const GUEST_TAGS_MAX = 20

const TagName = z.string().trim().min(1).max(40)

export const Tag = z
  .object({
    id: z.uuid(),
    name: TagName,
    color: TagColor,
  })
  .strict()

export type Tag = z.infer<typeof Tag>

export const CreateTagInput = z
  .object({
    name: TagName,
    color: TagColor.default('slate'),
  })
  .strict()

export type CreateTagInput = z.infer<typeof CreateTagInput>

export const UpdateTagInput = z
  .object({
    name: TagName.optional(),
    color: TagColor.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Нечего менять: не передано ни одного поля',
  })

export type UpdateTagInput = z.infer<typeof UpdateTagInput>

/**
 * Теги гостя — набором целиком. Пустой список снимает все.
 *
 * Набор, а не «добавить или убрать»: экран показывает галочки, и сохранение
 * отправляет ровно то, что на нём отмечено.
 */
export const SetGuestTagsInput = z
  .object({
    tagIds: z
      .array(z.uuid())
      .max(GUEST_TAGS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'Один тег отмечен дважды'),
  })
  .strict()

export type SetGuestTagsInput = z.infer<typeof SetGuestTagsInput>

export const GuestTagsResult = z
  .object({
    tags: z.array(Tag),
  })
  .strict()

export type GuestTagsResult = z.infer<typeof GuestTagsResult>
