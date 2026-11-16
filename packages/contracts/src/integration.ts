import { z } from 'zod'

/**
 * Экран интеграции с кассой. docs/02, раздел 5.16.
 *
 * ЭТО ЭКРАН ДЛЯ РАЗБОРА, А НЕ ДЛЯ НАСТРОЙКИ. Одно исключение — кнопка «Подключить
 * кассу»: связку заводит владелец, а идентификатор и ключ вписывает в кассу сам.
 * В остальном отсюда отвечают на один вопрос — «почему чеки не приходят».
 * Поэтому здесь адреса, ключ и счётчики принятого, а не поля ввода.
 *
 * КЛЮЧ ПОКАЗЫВАЕТСЯ ПО ОТДЕЛЬНОЙ ПРОСЬБЕ И УХОДИТ В ИСТОРИЮ. Им подписывают
 * чеки: кто им владеет, начисляет баллы от имени заведения. Открытый на экране
 * «на всякий случай» ключ рано или поздно уедет в переписку.
 */

export const IntegrationStatus = z
  .object({
    /** Касса подключена: есть живая связка с заведением в POSitive POS. */
    connected: z.boolean(),
    /** Идентификатор заведения в кассе. null — не подключено. */
    posMerchantId: z.string().nullable(),
    /** Когда подключили. */
    linkedAt: z.iso.datetime().nullable(),
    /** Куда касса шлёт чеки — наш адрес приёма. */
    inboundUrl: z.string(),
    /** Куда мы шлём события кассе. null — касса их не принимает. */
    callbackUrl: z.string().nullable(),
    /** Ключ подписи, замаскированный: «pos_••••4821». */
    secretMasked: z.string().nullable(),
    /** Событий принято за последние семь дней. */
    receivedWeek: z.number().int().nonnegative(),
    /** Из них ждут обработки. */
    pending: z.number().int().nonnegative(),
    /** Из них не удалось обработать — их разбирает человек. */
    failed: z.number().int().nonnegative(),
    /** Когда пришло последнее событие. null — не приходило ни одного. */
    lastEventAt: z.iso.datetime().nullable(),
  })
  .strict()

export type IntegrationStatus = z.infer<typeof IntegrationStatus>

/** Полный ключ — по отдельной просьбе владельца. */
export const IntegrationSecret = z.object({ secret: z.string() }).strict()
export type IntegrationSecret = z.infer<typeof IntegrationSecret>

/**
 * Перевыпуск ключа.
 *
 * ПРИЧИНА ОБЯЗАТЕЛЬНА И УХОДИТ В ИСТОРИЮ: после перевыпуска касса перестаёт
 * присылать чеки, пока в ней не поменяют ключ. Это действие с последствиями
 * для работы зала, и в журнале должно быть видно, зачем его делали.
 */
export const RotateSecretInput = z
  .object({
    reason: z.string().trim().min(8, 'Опишите причину — не меньше восьми знаков').max(300),
  })
  .strict()

export type RotateSecretInput = z.infer<typeof RotateSecretInput>

/**
 * Что вписать в настройки кассы. Отдаётся один раз — при подключении.
 *
 * Адрес сервера здесь же: заведению незачем знать, где мы живём, а кассе нужен
 * ровно этот адрес. Пусто — `PUBLIC_API_URL` не настроен.
 */
export const IntegrationConnected = z
  .object({
    posMerchantId: z.string(),
    secret: z.string(),
    apiUrl: z.string(),
  })
  .strict()

export type IntegrationConnected = z.infer<typeof IntegrationConnected>

/** Просьба кассы о токене: тело подписывается ключом связки (docs/02, раздел 3.10). */
export const PosLinkTokenInput = z.object({ posMerchantId: z.string().min(1).max(128) }).strict()
export type PosLinkTokenInput = z.infer<typeof PosLinkTokenInput>

export const PosLinkToken = z
  .object({
    accessToken: z.string(),
    /** Сколько секунд он живёт. Касса берёт новый заранее, а не ловит 401. */
    expiresIn: z.number().int().positive(),
  })
  .strict()

export type PosLinkToken = z.infer<typeof PosLinkToken>
