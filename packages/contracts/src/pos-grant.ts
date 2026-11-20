import { z } from 'zod'

/**
 * Промокод POSitive в кошельке гостя: выдача и аннулирование связкой кассы.
 *
 * Источник правды — POSitive: там промокод создан, там он гасится на кассе и на
 * сайте, там считается лимит. Сюда он приходит, чтобы гость увидел его у себя
 * в кошельке тем же кодом, что ему прислали сообщением, — и чтобы касса POSitive
 * погасила его здесь (`POST /v1/pos/grants/redeem`), когда гость его предъявит.
 */
export const IssuePosGrantInput = z
  .object({
    /** Телефон гостя-участника этого заведения. Не участник — 404, гостя не заводим. */
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Телефон в формате E.164, например +66812345678'),
    /**
     * Код, который гостю уже прислали. Правила промокода POSitive: латиница, цифры,
     * `_` и `-`, 3–24 знака, первый — буква или цифра. К верхнему регистру
     * приводим здесь: гость набирает как угодно.
     */
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/, 'Код — латиница, цифры, _ и -, 3–24 знака')
      .transform((value) => value.toUpperCase()),
    /** Что гость получает — строка, которую он увидит в кошельке. */
    title: z.string().trim().min(1).max(120),
    /** Условия одной-двумя строками: «от ฿500», «Кефир и ThaiNuki». */
    howTo: z.array(z.string().trim().min(1).max(200)).max(4).optional(),
    /** Последний момент действия кода. */
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export type IssuePosGrantInput = z.infer<typeof IssuePosGrantInput>

export const IssuePosGrantResult = z
  .object({
    grantId: z.uuid(),
    code: z.string(),
    expiresAt: z.iso.datetime(),
    /** Тот же Idempotency-Key пришёл повторно — возвращён первый ответ. */
    replayed: z.boolean(),
  })
  .strict()

export type IssuePosGrantResult = z.infer<typeof IssuePosGrantResult>

export const VoidPosGrantResult = z
  .object({
    code: z.string(),
    /** Аннулировано сейчас; false — код уже не был активен (погашен, истёк или снят раньше). */
    voided: z.boolean(),
    state: z.enum(['ISSUED', 'REDEEMED', 'EXPIRED', 'VOID']),
  })
  .strict()

export type VoidPosGrantResult = z.infer<typeof VoidPosGrantResult>
