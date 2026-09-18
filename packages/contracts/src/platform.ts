import { z } from 'zod'

/**
 * Контракты админки платформы (docs/02, раздел 6).
 *
 * Отдельный неймспейс `/v1/platform/*`, отдельный контур входа, отдельный
 * процесс. Вход, заведения и разбор жалоб на спам в приглашениях.
 */

/**
 * Вход одним шагом: почта, пароль и код второго фактора приходят разом.
 *
 * Привычная двухшаговая форма («пароль принят, введите код») удобнее, но она
 * сама по себе подсказывает, верен ли пароль. Для учётной записи, которая
 * видит данные всех заведений, такая подсказка дороже удобства.
 */
export const PlatformSignInInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),

    /**
     * Двенадцать символов — не придирка. У этой учётной записи нет заведения,
     * за которым можно спрятаться: она видит всех сразу, и цена подобранного
     * пароля здесь не «один ресторан», а «все рестораны».
     */
    password: z.string().min(12).max(200),

    /**
     * Второй фактор: шесть цифр из аутентификатора ИЛИ код восстановления.
     *
     * ОДНО ПОЛЕ НА ДВА ВИДА КОДА, а не два поля с переключателем. Человек,
     * потерявший телефон, и так в неприятной ситуации; заставлять его сначала
     * объяснить форме, каким именно кодом он собрался входить, — лишний шаг
     * там, где и без того нервно. Что предъявлено, сервер разберёт сам:
     * шесть цифр не спутать с двенадцатью буквами.
     */
    totpCode: z
      .string()
      .trim()
      .regex(
        /^(\d{3}\s?\d{3}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12})$/i,
        'Шесть цифр из аутентификатора или код восстановления',
      ),

    /**
     * Идентификатор устройства, постоянный между входами.
     *
     * Взял на себя роль IP-allowlist, отменённого 9 сентября 2026 (docs/05,
     * раздел 2): список адресов и вход с телефона несовместимы, потому что
     * мобильный оператор выдаёт новый адрес почти каждое подключение.
     *
     * В базе от него хранится только хеш: украденная база не должна давать
     * готовое значение, которым можно притвориться доверенным устройством.
     */
    deviceId: z.string().min(16).max(200),

    /** «iPhone Артёма» — чтобы отзывать доверие осознанно, а не по идентификатору. */
    deviceLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

export type PlatformSignInInput = z.infer<typeof PlatformSignInInput>

export const PlatformSignInResult = z
  .object({
    adminId: z.string().uuid(),
    displayName: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    /** Секунды жизни accessToken. Клиент не должен вычитывать это из самого токена. */
    expiresIn: z.number().int().positive(),
    /**
     * Устройство завели прямо сейчас — экран входа обязан об этом сказать.
     * Молчаливое доверие новому устройству — это то, о чём владелец узнаёт последним.
     */
    deviceEnrolled: z.boolean(),
  })
  .strict()

export type PlatformSignInResult = z.infer<typeof PlatformSignInResult>

/** Кто вошёл. Минимум полей: экран приветствия, а не профиль. */
export const PlatformMeResult = z
  .object({
    adminId: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    lastSeenAt: z.string().datetime().nullable(),
  })
  .strict()

export type PlatformMeResult = z.infer<typeof PlatformMeResult>

/**
 * Строка списка заведений.
 *
 * ─── ЧТО СЮДА НЕ ПОПАЛО И ПОЧЕМУ ─────────────────────────────────────────────
 *
 * Подписок, платежей, партнёрств и акций здесь нет не по забывчивости: таблиц
 * под них в схеме не существует. Показать «сколько платит» сегодня нечем —
 * у заведения есть лишь поле `plan`, которое перезаписывается на месте, без
 * истории, цены и даты следующего списания.
 *
 * Выдумывать эти цифры на экране нельзя: панель владельца платформы — то место,
 * где решения принимают по числам, и правдоподобное число хуже отсутствующего.
 *
 * ─── ПОЧЕМУ ЗДЕСЬ НЕТ ИМЁН И ТЕЛЕФОНОВ ───────────────────────────────────────
 *
 * Их не отдаст сама база: роль positive_platform не имеет прав на эти колонки
 * (миграция 20260909140000). Счёт гостей возможен, знакомство с ними — нет.
 */
export const PlatformTenantRow = z
  .object({
    id: z.string().uuid(),
    brandName: z.string(),
    vertical: z.string(),
    /** TRIAL | ACTIVE | PAUSED | CHURNED — то, что есть в схеме сегодня. */
    status: z.string(),
    /** FREE | PRO | NETWORK. Без истории и цены: их негде взять. */
    plan: z.string(),
    seasonMode: z.boolean(),
    currency: z.string(),
    createdAt: z.string().datetime(),

    /** Сколько гостей участвует в программе этого заведения. */
    guests: z.number().int().nonnegative(),
    /** Оборот по программе, в минорных единицах (сатангах). Железное правило 4. */
    spentTotal: z.number().int().nonnegative(),
    /** Баллов на руках у гостей — обязательство заведения. Тоже в минорных единицах. */
    pointsOutstanding: z.number().int(),
    visits: z.number().int().nonnegative(),
    /** Когда в этом заведении в последний раз что-то происходило. */
    lastVisitAt: z.string().datetime().nullable(),
    /** Операций за последние 30 дней — признак «живое или затухло». */
    operations30d: z.number().int().nonnegative(),
  })
  .strict()

export type PlatformTenantRow = z.infer<typeof PlatformTenantRow>

export const PlatformTenantsResult = z
  .object({
    tenants: z.array(PlatformTenantRow),
    /** Сводка по всем заведениям сразу — чтобы не складывать глазами. */
    totals: z
      .object({
        tenants: z.number().int().nonnegative(),
        paying: z.number().int().nonnegative(),
        trial: z.number().int().nonnegative(),
        guests: z.number().int().nonnegative(),
        spentTotal: z.number().int().nonnegative(),
      })
      .strict(),
    /** Момент, на который посчитано. Цифры живые, но снимок всё же на миг. */
    asOf: z.string().datetime(),
  })
  .strict()

export type PlatformTenantsResult = z.infer<typeof PlatformTenantsResult>

/**
 * Жалоба на спам в приглашениях — строкой для разбора (docs/07, раздел 6.2).
 *
 * Имя жалобщика и причина — только здесь, в панели платформы: обвинённому
 * заведению их не показывают, иначе жалоба стала бы поводом для ответной.
 */
export const PlatformInviteComplaint = z
  .object({
    fromTenantId: z.string().uuid(),
    fromBrandName: z.string(),
    /** Из блокировки, которую поставила жалоба. Объясняться никто не обязан. */
    reason: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()

export type PlatformInviteComplaint = z.infer<typeof PlatformInviteComplaint>

export const PlatformComplaintsRow = z
  .object({
    tenantId: z.string().uuid(),
    brandName: z.string(),
    /** Разные заведения: одно, пожаловавшееся дважды, — одна жалоба. */
    openComplaints: z.number().int().positive(),
    /** Приглашения приостановлены, пока жалобы не разобраны. */
    suspended: z.boolean(),
    lastComplaintAt: z.string().datetime(),
    complaints: z.array(PlatformInviteComplaint),
  })
  .strict()

export type PlatformComplaintsRow = z.infer<typeof PlatformComplaintsRow>

export const PlatformComplaintsResult = z
  .object({
    items: z.array(PlatformComplaintsRow),
    /** Со скольких жалоб приглашения приостанавливаются: экран не держит это число у себя. */
    suspendAfter: z.number().int().positive(),
  })
  .strict()

export type PlatformComplaintsResult = z.infer<typeof PlatformComplaintsResult>

export const PlatformComplaintsReviewResult = z
  .object({
    tenantId: z.string().uuid(),
    /** Сколько жалоб отмечено. Ноль — разбирать было нечего. */
    reviewed: z.number().int().nonnegative(),
  })
  .strict()

export type PlatformComplaintsReviewResult = z.infer<typeof PlatformComplaintsReviewResult>
