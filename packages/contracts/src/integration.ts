import { z } from 'zod'

/**
 * Экран интеграции с кассой. docs/02, раздел 5.16.
 *
 * ЭТО ЭКРАН ДЛЯ РАЗБОРА, А НЕ ДЛЯ НАСТРОЙКИ. Подключение заводит касса, когда
 * заведение к ней подключают; отсюда владелец отвечает на один вопрос — «почему
 * чеки не приходят». Поэтому здесь адреса, ключ и счётчики принятого, а не поля
 * ввода.
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
