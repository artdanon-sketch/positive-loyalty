import { z } from 'zod'

import { StaffRewardConfig } from './tenant.js'

/**
 * Мотивация кассиров, как её меняет владелец. docs/03, раздел 6 · docs/02, раздел 5.6.6.
 *
 * ПЛАТИМ ЗА ПРИВЕДЁННОГО ЧЕЛОВЕКА, А НЕ ЗА ОФОРМЛЕНИЕ. Отсюда и умолчания:
 * база «за нового гостя» и зачёт на втором визите. Оформить можно случайного
 * прохожего, который больше не придёт, — платить за это не за что.
 *
 * АНТИФРОД-ПРАВИЛА СЮДА НЕ ВЫНЕСЕНЫ НАМЕРЕННО (docs/03, раздел 6: «не даём
 * владельцу отключить»). Чек на свой номер, отменённый чек и потолок смены —
 * не настройки, а условия, без которых доплата становится премией за накрутку.
 */

/** Потолок фиксированной награды: 10 000 ฿ за гостя — опечатка, а не щедрость. */
export const STAFF_REWARD_MAX = 1_000_000

/** Потолок процента: больше половины чека кассиру — это не мотивация. */
export const STAFF_REWARD_PCT_MAX = 50

/** Потолок наград за смену. */
export const STAFF_SHIFT_CAP_MAX = 200

export const StaffRewardBasis = StaffRewardConfig.shape.basis
export type StaffRewardBasis = z.infer<typeof StaffRewardBasis>

export const StaffRewardSettings = z
  .object({
    enabled: z.boolean(),
    basis: StaffRewardBasis,
    /**
     * Сумма в минорных единицах для «за нового гостя» либо процент для двух
     * остальных баз. Смысл задаёт `basis` — и предел тоже: проверка ниже.
     */
    value: z.number().nonnegative(),
    vesting: StaffRewardConfig.shape.vesting,
    /** Потолок наград за смену — защита от накрутки, а не удобство. */
    shiftCap: z.number().int().nonnegative().max(STAFF_SHIFT_CAP_MAX),
  })
  .strict()
  .refine((input) => !input.enabled || input.value > 0, {
    error: 'Включённая доплата не может быть нулевой',
    path: ['value'],
  })
  .refine((input) => input.basis !== 'PER_NEW_GUEST' || input.value <= STAFF_REWARD_MAX, {
    error: `Награда за гостя — не больше ${String(STAFF_REWARD_MAX / 100)} ฿`,
    path: ['value'],
  })
  .refine((input) => input.basis === 'PER_NEW_GUEST' || input.value <= STAFF_REWARD_PCT_MAX, {
    error: `Процент — не больше ${String(STAFF_REWARD_PCT_MAX)}`,
    path: ['value'],
  })

export type StaffRewardSettings = z.infer<typeof StaffRewardSettings>

/**
 * Пять правил, по которым доплата НЕ начисляется. Показываются владельцу серым
 * и не отключаются: без них доплата — премия за накрутку (docs/03, раздел 6).
 */
export const STAFF_REWARD_RULES: readonly string[] = [
  'Чек на гостя с номером самого сотрудника',
  'Отменённый чек — награда снимается',
  'Постоянный гость, если платим только за новых',
  'Награды сверх лимита за смену',
  'Начисление без чека — ручная правка баланса',
]
