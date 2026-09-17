import { z } from 'zod'

/**
 * Уведомления в приложении гостя (Web Push). docs/02, раздел 2.10.
 *
 * ПОДПИСКУ ВЫДАЁТ БРАУЗЕР, а не мы: гость разрешает уведомления, браузер идёт
 * к своей службе доставки (Google для Chrome, Mozilla для Firefox) и возвращает
 * адрес и два ключа. Мы их только храним и предъявляем, когда шлём.
 *
 * АДРЕС ПОДПИСКИ — ЭТО ИДЕНТИФИКАТОР УСТРОЙСТВА, а не гостя: у одного человека
 * телефон и планшет — две подписки, а переустановка приложения даёт новый адрес.
 */

export const PushSubscribeInput = z
  .object({
    /** Адрес службы доставки. Длинный и непредсказуемый — отсюда щедрый предел. */
    endpoint: z.url().max(1000),
    keys: z
      .object({
        /** Открытый ключ устройства: им шифруется тело уведомления. */
        p256dh: z.string().min(20).max(255),
        /** Соль шифрования. */
        auth: z.string().min(8).max(255),
      })
      .strict(),
  })
  .strict()

export type PushSubscribeInput = z.infer<typeof PushSubscribeInput>

export const PushUnsubscribeInput = z.object({ endpoint: z.url().max(1000) }).strict()
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInput>

/**
 * Что нужно приложению, чтобы подписаться.
 *
 * Открытый ключ не секрет: без него браузер не умеет создать подписку. Пустая
 * строка и `enabled: false` — уведомления на сервере не настроены, и приложение
 * не должно показывать кнопку, которая гарантированно ничего не сделает.
 */
export const PushConfig = z
  .object({
    enabled: z.boolean(),
    publicKey: z.string(),
  })
  .strict()

export type PushConfig = z.infer<typeof PushConfig>

export const PushSubscribed = z.object({ ok: z.literal(true) }).strict()
export type PushSubscribed = z.infer<typeof PushSubscribed>
