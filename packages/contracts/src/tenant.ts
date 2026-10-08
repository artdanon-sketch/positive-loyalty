import { z } from 'zod'

import { BirthdayConfig } from './birthday.js'
import { NO_REFERRAL_LEVELS, ReferralLevels } from './referral.js'
import { ReviewConfig } from './review-config.js'
import { SuspiciousConfig } from './security-config.js'

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

export type TierCondition = z.infer<typeof TierCondition>

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

export type Tier = z.infer<typeof Tier>

export const CashierRules = z
  .object({
    /** Номер чека обязателен: без него операцию не с чем сверить при разборе. */
    requireReceiptNumber: z.boolean().default(true),
    /** Потолок суммы для ручного ввода. null — без потолка. */
    maxManualAmount: z.number().int().positive().nullable().default(null),
    allowManualEntry: z.boolean().default(true),
    /**
     * Кассир видит теги гостя на экране кассы.
     *
     * ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ, и это не осторожность ради осторожности: теги
     * заводит владелец для себя, и среди них бывают «жалобщик» и «не давать
     * скидку». Такой тег, увиденный кассиром через плечо гостя, — испорченный
     * вечер и потерянный человек. Включает владелец, зная свои теги.
     */
    showGuestTags: z.boolean().default(false),
    /**
     * Кассир может повесить гостю тег из справочника заведения.
     *
     * Только из справочника: заводить новые теги с кассы нельзя, иначе через
     * месяц там будет «пост », «постоянный», «Постоянный!» и никакой выборки
     * по ним не собрать.
     */
    allowTagging: z.boolean().default(false),
    /**
     * Кассир видит СВОИ проведённые операции за период.
     *
     * ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ. История смены — это выручка заведения, разложенная
     * по часам и гостям. Одним она помогает себя проверить, другим — посчитать,
     * сколько прошло мимо кассы. Владелец решает сам, кому из них он открывает.
     */
    showOwnHistory: z.boolean().default(false),
    /**
     * Кассир видит свои показатели: среднюю оценку гостей и выручку за смену.
     *
     * ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ по той же причине. Оценка вдобавок штука тонкая:
     * в маленькой смене по ней узнаётся конкретный гость, который её поставил.
     */
    showOwnStats: z.boolean().default(false),
    /**
     * Кассир может показать гостю QR заведения и записать его на месте.
     *
     * ВКЛЮЧЕНО ПО УМОЛЧАНИЮ, в отличие от двух правил выше: это не просмотр
     * чужих цифр, а прямая работа кассира. Запретить её значит заставить
     * гостя искать табличку на стойке, пока очередь ждёт.
     */
    allowInvite: z.boolean().default(true),
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

export type WelcomeBonus = z.infer<typeof WelcomeBonus>

/**
 * Приглашения друзей. docs/11, У6.
 *
 * Разбор того, что уже лежит в базе, — мягче ReferralSettings, по которой владелец
 * сохраняет (referral.ts): старые настройки без этого ключа читаются как «выключено».
 */
export const ReferralConfig = z
  .object({
    enabled: z.boolean().default(false),
    /** Баллы пригласившему за друга, в минорных единицах. */
    reward: z.number().int().nonnegative().default(0),
    /** Сколько разовых наград может получить один гость. */
    limit: z.number().int().positive().default(10),
    /** Процент с покупок друзей по кругам (referral.ts). Старые настройки — без процентов. */
    levels: ReferralLevels.default(() => [...NO_REFERRAL_LEVELS]),
  })
  .strict()

export type ReferralConfig = z.infer<typeof ReferralConfig>

/**
 * Мотивация персонала. docs/01, раздел 4.6.
 *
 * Схема объявлена целиком, хотя движок наград приедет со Срезом 5: заведения
 * настраиваются по ТЗ уже сейчас, и `.strict()` обязан принимать документ,
 * а не подмножество, удобное текущему коду. Ровно на этом касса и упала —
 * seed писал настройки по ТЗ, схема их отвергала, предрасчёт отдавал 500.
 */
export const StaffRewardConfig = z
  .object({
    enabled: z.boolean().default(false),
    basis: z.enum(['PER_NEW_GUEST', 'PCT_OF_POINTS', 'PCT_OF_REVENUE']).default('PER_NEW_GUEST'),
    /** Сумма в минорных единицах либо процент — смысл задаёт basis. */
    value: z.number().nonnegative().default(0),
    /** Дозревание: платить сразу или после второго визита (docs/00, пять решений). */
    vesting: z.enum(['IMMEDIATE', 'ON_SECOND_VISIT']).default('ON_SECOND_VISIT'),
    /** Потолок наград за смену — защита от накрутки. */
    shiftCap: z.number().int().nonnegative().default(15),
  })
  .strict()

export type StaffRewardConfig = z.infer<typeof StaffRewardConfig>

/** Приём заказов. docs/01, раздел 4.3. */
export const OrderingConfig = z
  .object({
    mode: z.enum(['OFF', 'EXTERNAL_LINK', 'BUILTIN', 'AGGREGATOR']).default('OFF'),
    url: z.url().optional(),
  })
  .strict()

export type OrderingConfig = z.infer<typeof OrderingConfig>

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
    referral: ReferralConfig.default(ReferralConfig.parse({})),
    birthday: BirthdayConfig.default(BirthdayConfig.parse({})),
    reviews: ReviewConfig.default(ReviewConfig.parse({})),
    suspicious: SuspiciousConfig.default(SuspiciousConfig.parse({})),
    tiers: z.array(Tier).default([]),
    cashierRules: CashierRules.default(CashierRules.parse({})),
    staffReward: StaffRewardConfig.default(StaffRewardConfig.parse({})),
    ordering: OrderingConfig.default(OrderingConfig.parse({})),
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

/**
 * Настройки программы, которые владелец меняет из бэк-офиса. docs/02, раздел 5.6.
 *
 * ТОЛЬКО ТО, ЧТО КАССА УЖЕ СОБЛЮДАЕТ. Статусы и приветственные баллы касса
 * соблюдает, но меняются они отдельным входом — TierSettings (tier.ts).
 * Переключатель, который ничего не делает, хуже отсутствующего: владелец
 * включит «сгорание через год» и будет уверен, что баллы сгорают.
 *
 * Поэтому каждое поле здесь проверено тем, что его читает касса:
 * pos.service (режим, начисление, потолок оплаты баллами, правила ввода) и
 * pos-webhook.service (начисление по чеку из кассы POSitive).
 *
 * Поля ОБЯЗАТЕЛЬНЫ, а не со значениями по умолчанию: это замена трёх настроек
 * целиком. Необязательное поле здесь молча превращало бы «не прислал» в
 * «сбросить на пять процентов».
 */
export const ProgramSettings = z
  .object({
    /**
     * Чем программа платит гостю за покупку. docs/02, раздел 3.2.
     *
     * CASHBACK — баллами на следующий визит. DISCOUNT — скидкой сразу, в этом
     * же чеке, по той же ставке: процент начисления становится процентом скидки,
     * а баллы с покупки не начисляются. Накопленное гость по-прежнему тратит.
     *
     * НЕОБЯЗАТЕЛЬНОЕ ПОЛЕ — по той же причине, что и pointsExpireDays ниже:
     * клиент, который о режиме не знает, не переключает его обратно.
     */
    mode: ProgramMode.optional(),
    /** Процент начисления от суммы, оплаченной деньгами. В режиме DISCOUNT — процент скидки. */
    baseEarnRate: z.number().min(0).max(50),
    /** Какую долю чека гость может оплатить баллами. */
    baseRedeemRate: z.number().min(0).max(100),
    /**
     * Через сколько дней сгорают баллы. null — не сгорают.
     *
     * НЕОБЯЗАТЕЛЬНОЕ ПОЛЕ: клиент, который о нём не знает, сохраняет остальное
     * по-прежнему и чужую настройку не сбрасывает.
     *
     * Меньше месяца не даём: баллы, сгорающие через неделю, — это не программа
     * лояльности, а способ поссориться с гостем.
     */
    pointsExpireDays: z.number().int().min(30).max(3650).nullable().optional(),
    cashierRules: z
      .object({
        requireReceiptNumber: z.boolean(),
        /** Потолок суммы ручного ввода в минорных единицах. null — без потолка. */
        maxManualAmount: z.number().int().positive().max(2_147_483_647).nullable(),
        allowManualEntry: z.boolean(),
        /**
         * Кассир видит теги гостя.
         *
         * НЕОБЯЗАТЕЛЬНОЕ ПОЛЕ, и это не небрежность: настройка появилась позже
         * самого экрана настроек, и клиент, который о ней не знает, обязан
         * сохранять остальное по-прежнему. Отсутствие ключа означает «не трогай»,
         * а не «выключи» — иначе старая вкладка браузера сбрасывала бы чужую
         * настройку каждым сохранением.
         */
        showGuestTags: z.boolean().optional(),
        /**
         * Что кассиру открыто на его собственном экране. Все три — НЕОБЯЗАТЕЛЬНЫЕ
         * по той же причине, что и showGuestTags выше: отсутствие ключа значит
         * «не трогай», а не «выключи».
         */
        showOwnHistory: z.boolean().optional(),
        showOwnStats: z.boolean().optional(),
        allowInvite: z.boolean().optional(),
        /** Кассир вешает теги из справочника заведения. */
        allowTagging: z.boolean().optional(),
      })
      .strict(),
  })
  .strict()

export type ProgramSettings = z.infer<typeof ProgramSettings>
