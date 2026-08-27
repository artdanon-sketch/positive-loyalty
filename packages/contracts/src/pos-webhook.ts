import { z } from 'zod'

import { PaidBy } from './pos.js'

/**
 * Вебхуки от POSitive POS. docs/02, раздел 4.
 *
 * ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ МЫ РАЗБИРАЕМ ЧУЖОЙ ФОРМАТ. Всё остальное API
 * принимает то, что сами же и описали; здесь конверт задаёт касса, и меняться
 * он будет без нашего участия. Отсюда два следствия, заметных ниже:
 *
 *   • схема НЕ `.strict()`. Обычно строгость обязательна — она ловит опечатки
 *     в наших же вызовах. Но чужая сторона имеет полное право добавить поле
 *     в своё событие, и падать на этом означало бы терять чеки при каждом
 *     их релизе. Неизвестные поля игнорируются, известные проверяются;
 *   • необязательного больше, чем хотелось бы: касса не обещает заполнять
 *     всё, а событие без гостя нам всё равно нужно — по нему считается доля
 *     чеков с программой, главная метрика проникновения.
 */

/** Позиция чека. Нужна движку акций; в Срезе 2 просто сохраняется. */
export const PosReceiptItem = z.object({
  sku: z.string().min(1).max(128),
  qty: z.number().positive(),
  /** Цена за единицу в минорных единицах. */
  price: z.number().int().nonnegative(),
})

export type PosReceiptItem = z.infer<typeof PosReceiptItem>

/**
 * Как касса опознала гостя.
 *
 * Блок целиком необязателен: гостя могли не идентифицировать. Такой чек всё
 * равно принимается и обрабатывается — он ложится в статистику, а не в баллы.
 */
export const PosReceiptLoyalty = z.object({
  /** Подписанный токен с экрана гостя. */
  guestToken: z.string().min(8).max(512).optional(),
  /** Предрасчёт, если гость платил баллами. */
  previewId: z.uuid().optional(),
})

export type PosReceiptLoyalty = z.infer<typeof PosReceiptLoyalty>

export const PosReceipt = z.object({
  /** Идентификатор чека в кассе. Он же ключ идемпотентности начисления. */
  id: z.string().min(1).max(128),
  /** Человеческий номер чека, тот что на бумаге. */
  number: z.string().min(1).max(64).optional(),
  /** Итог чека в минорных единицах. */
  total: z.number().int().nonnegative(),
  currency: z.string().length(3).optional(),
  paidBy: PaidBy.optional(),
  closedAt: z.iso.datetime({ offset: true }),
  cashierId: z.string().min(1).max(128).optional(),
  loyalty: PosReceiptLoyalty.optional(),
  items: z.array(PosReceiptItem).optional(),
})

export type PosReceipt = z.infer<typeof PosReceipt>

/** Виды событий, которые мы понимаем. Остальные принимаются и пропускаются. */
export const PosWebhookEventType = z.enum(['receipt.closed', 'receipt.voided'])
export type PosWebhookEventType = z.infer<typeof PosWebhookEventType>

export const PosWebhookEnvelope = z.object({
  event: PosWebhookEventType,
  occurredAt: z.iso.datetime({ offset: true }),
  posMerchantId: z.string().min(1).max(128),
  posLocationId: z.string().min(1).max(128).optional(),
  receipt: PosReceipt,
})

export type PosWebhookEnvelope = z.infer<typeof PosWebhookEnvelope>

/**
 * Ответ на вебхук.
 *
 * `202`, а не `200`, и это не косметика: ТЗ прямо оговаривает, что «2xx
 * не означает „баллы начислены“ — означает „событие принято“». Двести
 * второй код именно это и означает, и касса по нему не должна ничего
 * дорисовывать.
 */
export const PosWebhookAccepted = z
  .object({
    /** Наш идентификатор принятого события. По нему можно спросить статус. */
    eventId: z.uuid(),
    /**
     * Событие с таким ключом уже приходило. Ответ тот же самый — повтор
     * не ошибка, а нормальная работа кассы с плохой связью.
     */
    duplicate: z.boolean(),
  })
  .strict()

export type PosWebhookAccepted = z.infer<typeof PosWebhookAccepted>

// ─── Исходящие события к кассе ───────────────────────────────────────────────

/**
 * Баланс гостя изменился. docs/02, раздел 4.3.
 *
 * Шлём, чтобы касса показывала свежий баланс, не спрашивая нас на каждый чек.
 * Только про изменения ВНЕ этой кассы: о том, что сделала она сама, касса
 * знает и без нас, а лишнее событие — лишний повод рассинхронизироваться.
 *
 * ЗДЕСЬ НЕТ НИ ИМЕНИ, НИ ТЕЛЕФОНА. Событие уходит наружу, в чужую систему,
 * и несёт ровно то, без чего касса не покажет баланс: кого и сколько.
 * Всё остальное касса и так знает про своего гостя (железное правило 5).
 */
export const GuestBalanceChanged = z
  .object({
    event: z.literal('guest.balance_changed'),
    /** Наш идентификатор события. По нему касса дедуплицирует у себя. */
    eventId: z.uuid(),
    occurredAt: z.iso.datetime(),
    /** Идентификатор гостя в НАШЕЙ системе: касса связывает его при опознании. */
    guestId: z.uuid(),
    /** Новый баланс в минорных единицах. */
    balance: z.number().int(),
    /** Насколько изменился: знаковое. */
    delta: z.number().int(),
  })
  .strict()

export type GuestBalanceChanged = z.infer<typeof GuestBalanceChanged>
