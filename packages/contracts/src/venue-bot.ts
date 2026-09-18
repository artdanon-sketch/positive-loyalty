import { z } from 'zod'

/**
 * Свой Telegram-бот у заведения. docs/02, раздел 5.18.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Сообщение от «POSitive Loyalty» гость читает как рассылку
 * сервиса, о котором он не помнит. Сообщение от «Kata Beach Kitchen» — как
 * письмо от знакомого кафе. Это не украшение: от имени отправителя зависит,
 * откроют сообщение или отпишутся.
 *
 * КЛЮЧ БОТА — НАСТОЯЩИЙ СЕКРЕТ. Кто им владеет, читает переписку бота и пишет
 * от его имени. На экране он всегда замаскирован и обратно не показывается:
 * потерявший ключ владелец берёт новый у @BotFather, а не у нас.
 *
 * БОТ ЗАВЕДЕНИЯ НЕ ЗАМЕНЯЕТ ОБЩЕГО. Вход в карту остаётся на общем боте: гость
 * заводит карту один раз на все заведения острова, и заставлять его запускать
 * по боту на каждое кафе ради входа — верный способ потерять половину.
 */

/** Формат ключа от @BotFather: «<число>:<строка>». */
const BotToken = z
  .string()
  .trim()
  .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'Не похоже на ключ бота: ожидается «<число>:<строка>»')

export const ConnectVenueBotInput = z.object({ token: BotToken }).strict()
export type ConnectVenueBotInput = z.infer<typeof ConnectVenueBotInput>

export const VenueBotStatus = z
  .object({
    /** Бот подключён и работает. */
    connected: z.boolean(),
    /** Имя бота для ссылки `t.me/<имя>`. null — не подключён. */
    username: z.string().nullable(),
    /** Ключ хвостом: сверить с тем, что выдал @BotFather. */
    tokenMasked: z.string().nullable(),
    /** Сколько гостей запустили этого бота — им и уходят сообщения заведения. */
    subscribers: z.number().int().nonnegative(),
    /** Когда подключили. */
    connectedAt: z.iso.datetime().nullable(),
  })
  .strict()

export type VenueBotStatus = z.infer<typeof VenueBotStatus>
