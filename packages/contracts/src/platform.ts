import { z } from 'zod'

/**
 * Контракты админки платформы (docs/02, раздел 6).
 *
 * Отдельный неймспейс `/v1/platform/*`, отдельный контур входа, отдельный
 * процесс. Здесь описан только вход — экраны появятся следующим шагом.
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

    /** Ровно шесть цифр. Пробелы из «123 456» снимаются на сервере. */
    totpCode: z.string().regex(/^\d{3}\s?\d{3}$/, 'Код — шесть цифр из приложения-аутентификатора'),

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
