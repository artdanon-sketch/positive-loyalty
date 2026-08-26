import { z } from 'zod'

/**
 * Конфигурация программы лояльности заведения.
 * docs/01_Архитектура_и_данные.md, раздел 4.3 — хранится в `Tenant.settings`.
 *
 * У КАЖДОГО ПОЛЯ ЕСТЬ ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ, и это не лень. Заведение заводится
 * до того, как владелец дошёл до настроек, и до тех пор программа обязана
 * работать: пустой объект `{}` разбирается в осмысленный набор. Иначе первый
 * же чек в новом заведении упал бы на валидации конфигурации.
 *
 * `.strict()` при этом на месте: неизвестное поле — это опечатка в настройках,
 * а молча проигнорированная опечатка в проценте начисления стоит денег.
 */

/** Как работает программа: копим баллы или сразу снижаем чек. Взято у UDS (docs/00). */
export const ProgramMode = z.enum(['CASHBACK', 'DISCOUNT'])
export type ProgramMode = z.infer<typeof ProgramMode>

export const TierCondition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SPENT_TOTAL'), gt: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('VISITS_TOTAL'), gt: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('REFERRALS'), gt: z.number().int().nonnegative() }).strict(),
])

export const Tier = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    earnRate: z.number().min(0).max(50),
    redeemRate: z.number().min(0).max(100),
    /** Скрытый статус назначается вручную и не показывается в лестнице. */
    hidden: z.boolean().default(false),
    conditions: z.array(TierCondition).default([]),
  })
  .strict()

export const CashierRules = z
  .object({
    /** Номер чека обязателен: без него операцию не с чем сверить при разборе. */
    requireReceiptNumber: z.boolean().default(true),
    /** Потолок суммы для ручного ввода. null — без потолка. */
    maxManualAmount: z.number().int().positive().nullable().default(null),
    allowManualEntry: z.boolean().default(true),
  })
  .strict()

export type CashierRules = z.infer<typeof CashierRules>

export const WelcomeBonus = z
  .object({
    enabled: z.boolean().default(false),
    amount: z.number().int().nonnegative().default(0),
    trigger: z.enum(['ON_JOIN', 'ON_FIRST_PURCHASE']).default('ON_FIRST_PURCHASE'),
  })
  .strict()

export const ProgramConfig = z
  .object({
    mode: ProgramMode.default('CASHBACK'),
    /** Процент начисления от суммы чека. */
    baseEarnRate: z.number().min(0).max(50).default(5),
    /** Какую долю чека разрешено оплатить баллами. */
    baseRedeemRate: z.number().min(0).max(100).default(20),
    /** null — баллы не сгорают. */
    pointsExpireDays: z.number().int().positive().nullable().default(null),
    // .default() в zod 4 принимает ВЫХОДНОЙ тип, а не входной: пустой объект
    // ему не подходит, хотя сама схема его разбирает. Прогоняем `{}` через
    // схему один раз при загрузке модуля — так значения по умолчанию не
    // дублируются и не разъезжаются с объявлением полей.
    welcomeBonus: WelcomeBonus.default(WelcomeBonus.parse({})),
    tiers: z.array(Tier).default([]),
    cashierRules: CashierRules.default(CashierRules.parse({})),
  })
  .strict()

export type ProgramConfig = z.infer<typeof ProgramConfig>

/**
 * Разбирает `Tenant.settings`.
 *
 * Отдельная функция, а не прямой `.parse()` на месте использования: настройки
 * лежат в JSON-колонке типа `unknown`, и приведение должно быть в одном месте.
 */
export const parseProgramConfig = (settings: unknown): ProgramConfig =>
  ProgramConfig.parse(settings ?? {})
