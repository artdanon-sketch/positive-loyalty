import { z } from 'zod'

/**
 * Каталог товаров и услуг. docs/02, раздел 5.17.
 *
 * ЭТО ВИТРИНА, А НЕ СКЛАД. Остатков, штрихкодов и поставщиков здесь нет и
 * не будет: за это отвечает касса. Нам нужно ровно одно — показать гостю, что
 * у заведения есть и что из этого можно взять за баллы.
 *
 * ЦЕНА В БАЛЛАХ — ГЛАВНОЕ ПОЛЕ. Без неё позиция просто украшает карту; с ней
 * гость видит цель, ради которой стоит копить. Заведение, которое не хочет
 * менять баллы на товар, оставляет поле пустым.
 */

export const CATALOG_NAME_MAX = 120
export const CATALOG_DESCRIPTION_MAX = 500
/** Сколько позиций отдаём разом: витрина, а не бесконечная лента. */
export const CATALOG_PAGE = 100

const Name = z.string().trim().min(2, 'Назовите позицию').max(CATALOG_NAME_MAX)
const Description = z.string().trim().max(CATALOG_DESCRIPTION_MAX)

/** Ссылка на картинку — как у новостей: хранилища файлов у нас пока нет. */
const ImageUrl = z
  .url('Нужна ссылка на картинку')
  .max(500)
  .refine((value) => value.startsWith('https://'), 'Ссылка должна начинаться с https://')

export const CatalogItem = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    /** Цена деньгами в минорных единицах. null — цену не показываем. */
    priceMinor: z.number().int().nonnegative().nullable(),
    /** Цена в баллах. null — за баллы не отдаём. */
    pointsPrice: z.number().int().positive().nullable(),
    imageUrl: z.url().nullable(),
    /** Выключенная позиция остаётся в списке владельца и исчезает у гостя. */
    isActive: z.boolean(),
    sortOrder: z.number().int(),
  })
  .strict()

export type CatalogItem = z.infer<typeof CatalogItem>

export const CreateCatalogItemInput = z
  .object({
    name: Name,
    description: Description.default(''),
    priceMinor: z.number().int().nonnegative().nullable().default(null),
    pointsPrice: z.number().int().positive().nullable().default(null),
    imageUrl: ImageUrl.nullable().default(null),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict()

export type CreateCatalogItemInput = z.infer<typeof CreateCatalogItemInput>

export const UpdateCatalogItemInput = z
  .object({
    name: Name.optional(),
    description: Description.optional(),
    priceMinor: z.number().int().nonnegative().nullable().optional(),
    pointsPrice: z.number().int().positive().nullable().optional(),
    imageUrl: ImageUrl.nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Нечего менять')

export type UpdateCatalogItemInput = z.infer<typeof UpdateCatalogItemInput>

/**
 * Витрина для гостя: только то, что можно взять за баллы.
 *
 * ПОЗИЦИИ БЕЗ ЦЕНЫ В БАЛЛАХ ГОСТЮ НЕ ПОКАЗЫВАЕМ. Карта лояльности — не меню:
 * список блюд с ценами в батах там только отвлекает от того, ради чего её
 * открыли.
 */
export const GuestCatalogItem = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    venue: z.string(),
    name: z.string(),
    description: z.string(),
    pointsPrice: z.number().int().positive(),
    imageUrl: z.url().nullable(),
    /** Хватает ли баллов гостю в этом заведении прямо сейчас. */
    affordable: z.boolean(),
  })
  .strict()

export type GuestCatalogItem = z.infer<typeof GuestCatalogItem>

export const GuestCatalog = z.object({ items: z.array(GuestCatalogItem) }).strict()
export type GuestCatalog = z.infer<typeof GuestCatalog>

/**
 * Что кассир может выдать гостю за баллы. docs/02, раздел 3.8.
 *
 * Без этого списка кассе было нечем пользоваться: гость видит в приложении
 * «покажите карту на кассе — списание проведёт кассир», а кассир не видел
 * ни наград, ни кнопки. «Хватает или нет» считает сервер — по балансу гостя
 * в этом заведении, тем же правилом, что и в приложении гостя.
 */
export const PosRewardsQuery = z
  .object({
    membershipId: z.uuid(),
  })
  .strict()

export type PosRewardsQuery = z.infer<typeof PosRewardsQuery>

export const PosReward = z
  .object({
    id: z.uuid(),
    name: z.string(),
    /** Цена в баллах — в тех же сотых долях, что и баланс. */
    pointsPrice: z.number().int().positive(),
    imageUrl: z.url().nullable(),
    affordable: z.boolean(),
  })
  .strict()

export type PosReward = z.infer<typeof PosReward>

export const PosRewards = z
  .object({
    /** Баланс гостя в этом заведении сейчас. */
    balance: z.number().int(),
    /** Позиции на витрине с ценой в баллах — в порядке владельца. */
    items: z.array(PosReward),
  })
  .strict()

export type PosRewards = z.infer<typeof PosRewards>

/**
 * Выдача награды за баллы на кассе. docs/02, раздел 3.8.
 *
 * ВЫДАЁТ КАССА, А НЕ ГОСТЬ САМ. Кнопка «получить» в телефоне означала бы, что
 * баллы списаны, а товар — как повезёт: гость нажал в очереди, ушёл и вернулся
 * через неделю. Списание и выдача происходят в один момент у стойки.
 *
 * `redemptionId` ПРИДУМЫВАЕТ КАССА и повторяет при повторной отправке: сеть
 * на планшете рвётся чаще, чем кажется, и второй раз списывать баллы за ту же
 * чашку кофе нельзя.
 */
export const RedeemRewardInput = z
  .object({
    membershipId: z.uuid(),
    itemId: z.uuid(),
    redemptionId: z.uuid(),
  })
  .strict()

export type RedeemRewardInput = z.infer<typeof RedeemRewardInput>

export const RedeemRewardResult = z
  .object({
    itemName: z.string(),
    /** Сколько баллов списали. */
    pointsSpent: z.number().int().positive(),
    /** Остаток гостя в этом заведении после выдачи. */
    balanceAfter: z.number().int().nonnegative(),
  })
  .strict()

export type RedeemRewardResult = z.infer<typeof RedeemRewardResult>
