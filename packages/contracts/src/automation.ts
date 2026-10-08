import { z } from 'zod'

import { BROADCAST_TEXT_MAX, BroadcastGift } from './broadcast.js'

/**
 * Автоматические сценарии рассылок. docs/02, раздел 5.4.1 · docs/03, раздел 5.
 *
 * ГОТОВЫЕ СЦЕНАРИИ, А НЕ КОНСТРУКТОР УСЛОВИЙ. Владелец кафе не строит воронки:
 * он хочет «напомнить тем, кто давно не заходил». Три сценария закрывают то,
 * ради чего автоматизацию вообще включают; произвольные условия — это язык
 * запросов, которым никто не пользуется.
 *
 * СЦЕНАРИЙ СОЗДАЁТ ОБЫЧНУЮ РАССЫЛКУ. Значит на него действуют те же правила:
 * не больше четырёх сообщений в месяц на гостя, отправка порциями, архив
 * с итогами доставки. Второй способ писать гостю нам не нужен.
 *
 * НЕ ЧАЩЕ РАЗА В СУТКИ. Сценарий срабатывает по состоянию («не заходил 30 дней»),
 * а это состояние держится долго: без такого правила гость получал бы письмо
 * каждый проход разгребателя.
 *
 * ОДИН РАЗ НА ГОСТЯ ЗА ЭПИЗОД. Суточного правила мало: спящий гость остаётся
 * спящим и завтра, и он получал бы «соскучились» каждый день, пока не упрётся
 * в усталость, — а с подарком ещё и баллы каждый день. Поэтому сценарий пишет
 * гостю один раз: «давно не заходил» — пока гость снова не придёт, «вступил,
 * но не купил» — один раз навсегда, «сумма покупок» — один раз на порог.
 */

export const AutomationKind = z.enum(['SLEEPING', 'JOINED_NO_PURCHASE', 'SPENT_TOTAL'])
export type AutomationKind = z.infer<typeof AutomationKind>

/** Пороги «в днях» — от недели: реже — это не сон, а график работы гостя. */
export const AUTOMATION_DAYS_MIN = 7
export const AUTOMATION_DAYS_MAX = 365

/** Порог суммы покупок: до миллиона батов. */
export const AUTOMATION_SPENT_MAX = 100_000_000

/**
 * Тело запроса на сохранение: вид сценария приходит в адресе, а время
 * последнего запуска ставит сервер.
 *
 * ФОРМА ОПИСАНА СНИЗУ ВВЕРХ — от тела запроса к полному правилу, а не вырезанием
 * полей: zod не даёт вырезать поля из схемы, к которой уже применена проверка
 * порога.
 */
export const SaveAutomationInput = z
  .object({
    enabled: z.boolean(),
    /** Дни для SLEEPING и JOINED_NO_PURCHASE, минорные единицы для SPENT_TOTAL. */
    threshold: z.number().int().positive(),
    text: z
      .string()
      .trim()
      .min(2, 'Напишите текст сообщения')
      .max(BROADCAST_TEXT_MAX, `Не длиннее ${String(BROADCAST_TEXT_MAX)} знаков`),
    /**
     * Подарок вместе с сообщением — баллы или сертификат, как у рассылки.
     * null — без подарка. Нет ключа — не трогать: старый экран, не знающий
     * о подарке, не должен снимать его каждым сохранением.
     */
    gift: BroadcastGift.nullable().optional(),
  })
  .strict()

export type SaveAutomationInput = z.infer<typeof SaveAutomationInput>

export const AutomationRule = SaveAutomationInput.extend({
  kind: AutomationKind,
  gift: BroadcastGift.nullable(),
  /** Когда сценарий отработал в последний раз. null — ещё ни разу. */
  lastRunAt: z.iso.datetime().nullable(),
  /**
   * Сколько гостей подходят под условие прямо сейчас и ещё не получали этот
   * эпизод — им придёт при следующем запуске. Владелец видит цену подарка
   * до того, как включит сценарий.
   */
  waiting: z.number().int().nonnegative(),
})
  .strict()
  .refine(
    (rule) =>
      rule.kind === 'SPENT_TOTAL'
        ? rule.threshold <= AUTOMATION_SPENT_MAX
        : rule.threshold >= AUTOMATION_DAYS_MIN && rule.threshold <= AUTOMATION_DAYS_MAX,
    { error: 'Порог вне допустимых значений для этого сценария', path: ['threshold'] },
  )

export type AutomationRule = z.infer<typeof AutomationRule>

export const AutomationRules = z
  .object({
    items: z.array(AutomationRule),
  })
  .strict()

export type AutomationRules = z.infer<typeof AutomationRules>
