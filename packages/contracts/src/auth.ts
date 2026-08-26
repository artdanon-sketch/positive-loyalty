import { z } from 'zod'

/**
 * Контракты аутентификации.
 * docs/02, раздел 1 · docs/05, разделы 2 и 3.
 */

/** Роли из docs/05, раздел 3. Матрица прав — там же. */
export const Role = z.enum(['CASHIER', 'MANAGER', 'OWNER', 'PLATFORM_ADMIN'])
export type Role = z.infer<typeof Role>

/**
 * Вход кассира по PIN.
 *
 * ЗДЕСЬ НЕТ tenantId, И ЭТО ГЛАВНОЕ. Заведение определяется по устройству:
 * `deviceId` глобально уникален и зарегистрирован владельцем. Приняв tenantId
 * от клиента, мы дали бы перебирать заведения по разнице ответов.
 *
 * PIN опознаёт сотрудника внутри заведения — отдельного идентификатора
 * сотрудника в запросе тоже нет: на планшете у кассы его вводить некому.
 */
export const StaffPinLoginInput = z
  .object({
    /** Отпечаток устройства. Без регистрации владельцем PIN не принимается. */
    deviceId: z.string().min(8).max(200),
    /** Четыре и более цифр. Верхняя граница — чтобы не хешировать килобайт. */
    pin: z.string().min(4).max(32).regex(/^\d+$/, 'PIN состоит только из цифр'),
  })
  .strict()

export type StaffPinLoginInput = z.infer<typeof StaffPinLoginInput>

export const RefreshInput = z
  .object({
    refreshToken: z.string().min(32).max(512),
  })
  .strict()

export type RefreshInput = z.infer<typeof RefreshInput>

/** Кто вошёл. Ни PIN, ни телефон целиком наружу не отдаются. */
export const AuthSubject = z
  .object({
    staffId: z.uuid(),
    displayName: z.string().min(1),
    role: Role,
    tenantId: z.uuid(),
  })
  .strict()

export type AuthSubject = z.infer<typeof AuthSubject>

export const AuthTokens = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    /** Срок жизни access в секундах. Кассиру — 8 часов (docs/05, раздел 2). */
    expiresIn: z.number().int().positive(),
    subject: AuthSubject,
  })
  .strict()

export type AuthTokens = z.infer<typeof AuthTokens>
