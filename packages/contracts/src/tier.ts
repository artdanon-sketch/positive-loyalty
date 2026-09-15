import { z } from 'zod'

import { TierCondition } from './tenant.js'

/**
 * Статусы гостей и приветственные баллы — как их меняет владелец.
 * docs/02, разделы 5.2.2 и 5.6.1 · docs/11, У3.
 *
 * ОТДЕЛЬНЫЙ ВХОД, А НЕ ПОЛЯ В ProgramSettings. Лестница статусов — свой экран,
 * и сохранение процента начисления не должно заодно переписывать статусы,
 * которых на том экране никто не видел.
 *
 * СТРОЖЕ, ЧЕМ РАЗБОР СТАРЫХ НАСТРОЕК. Tier в tenant.ts читает то, что уже лежит
 * в базе; здесь — то, что владелец сохраняет сейчас: короткие названия, не больше
 * десяти ступеней, по одному условию каждого вида.
 */

export const TIERS_MAX = 10

/** Потолок приветственных баллов: 10 000 ฿ за вступление — опечатка, а не щедрость. */
export const WELCOME_BONUS_MAX = 1_000_000

export const TierInput = z
  .object({
    /** Латиница, цифры и дефис: id живёт в участиях гостей и в партнёрских условиях. */
    id: z.string().regex(/^[a-z0-9-]{1,40}$/, 'id статуса: латиница, цифры и дефис, до 40 знаков'),
    name: z.string().trim().min(1).max(40),
    earnRate: z.number().min(0).max(50),
    redeemRate: z.number().min(0).max(100),
    hidden: z.boolean(),
    conditions: z
      .array(TierCondition)
      .max(3)
      .refine(
        (conditions) =>
          new Set(conditions.map((condition) => condition.type)).size === conditions.length,
        'По одному условию каждого вида',
      ),
  })
  .strict()

export type TierInput = z.infer<typeof TierInput>

export const WelcomeBonusInput = z
  .object({
    enabled: z.boolean(),
    /** Баллы в минорных единицах. */
    amount: z.number().int().nonnegative().max(WELCOME_BONUS_MAX),
    trigger: z.enum(['ON_JOIN', 'ON_FIRST_PURCHASE']),
  })
  .strict()
  .refine((bonus) => !bonus.enabled || bonus.amount > 0, {
    error: 'Включённые приветственные баллы не могут быть нулём',
    path: ['amount'],
  })

export type WelcomeBonusInput = z.infer<typeof WelcomeBonusInput>

/**
 * Лестница целиком и приветственные баллы. Оба поля обязательны: это замена
 * целиком, и «не прислал статусы» не должно значить «удалить все».
 */
export const TierSettings = z
  .object({
    tiers: z
      .array(TierInput)
      .max(TIERS_MAX)
      .refine(
        (tiers) => new Set(tiers.map((tier) => tier.id)).size === tiers.length,
        'У двух статусов один id',
      )
      .refine(
        (tiers) => new Set(tiers.map((tier) => tier.name.toLowerCase())).size === tiers.length,
        'Два статуса с одним названием гость не различит',
      ),
    welcomeBonus: WelcomeBonusInput,
  })
  .strict()

export type TierSettings = z.infer<typeof TierSettings>

/** Ручной статус гостя. `tierId: null` — вернуть гостя на лестницу. Причина уходит в аудит. */
export const SetGuestTierInput = z
  .object({
    tierId: z.string().min(1).max(40).nullable(),
    reason: z.string().trim().min(8).max(300),
  })
  .strict()

export type SetGuestTierInput = z.infer<typeof SetGuestTierInput>

export const GuestTierResult = z
  .object({
    tierId: z.string().nullable(),
    name: z.string().nullable(),
    manual: z.boolean(),
  })
  .strict()

export type GuestTierResult = z.infer<typeof GuestTierResult>

/** Статус гостя на кассе: название и ставки, по которым считается этот чек. */
export const TierBadge = z
  .object({
    id: z.string(),
    name: z.string(),
    earnRate: z.number(),
    redeemRate: z.number(),
  })
  .strict()

export type TierBadge = z.infer<typeof TierBadge>
