import { z } from 'zod'

/**
 * Тонкий клиент Telegram Bot API. Только те три метода, которыми мы правда
 * пользуемся: узнать себя, забрать сообщения, ответить.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: ключ бота не должен утечь в сообщение об ошибке.
 * В Telegram он передаётся ЧАСТЬЮ АДРЕСА — `api.telegram.org/bot<ключ>/метод`.
 * Значит любая ошибка, которая по привычке приложит адрес запроса, разом
 * опубликует ключ в логах. Поэтому наружу отдаётся только имя метода,
 * а исходная ошибка в текст не подставляется никогда.
 */

const ORIGIN = 'https://api.telegram.org'

/** Отказ Telegram или сети. Текст безопасен для логов: адреса в нём нет. */
export class TelegramError extends Error {
  constructor(method: string, reason: string) {
    super(`Telegram: метод ${method} не выполнен (${reason})`)
    this.name = 'TelegramError'
  }
}

const Envelope = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.unknown().optional(),
})

const Me = z.object({
  id: z.number().int(),
  username: z.string().min(1),
})

/**
 * Отправитель сообщения. `id` числовой и он же служит адресом чата
 * в личной переписке — именно поэтому вместе со входом мы получаем канал
 * доставки: писать гостю можно на тот же идентификатор.
 */
const Sender = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  /** Язык интерфейса Telegram: «ru», «en», «th», иногда с областью — «zh-hans». */
  language_code: z.string().optional(),
})

const Update = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      from: Sender.optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      text: z.string().optional(),
    })
    .optional(),
})

export type TelegramUpdate = z.infer<typeof Update>

/** Команда «Запустить» с одноразовым кодом из ссылки. */
export interface TelegramStart {
  readonly updateId: number
  readonly userId: string
  readonly chatId: string
  readonly displayName: string | null
  /** Язык гостя, приведённый к четырём языкам продукта. */
  readonly locale: string
  /** Код из ссылки. `null` — гость открыл бота сам, без нашей ссылки. */
  readonly payload: string | null
}

/** Четыре языка продукта (docs/04, раздел 7). Всё прочее — русский по умолчанию. */
const SUPPORTED_LOCALES = new Set(['ru', 'en', 'th', 'zh'])

/**
 * Приводит язык Telegram к нашему.
 *
 * Telegram присылает и «ru», и «zh-hans» — берём первые две буквы. Незнакомый
 * язык не выдумываем: незнакомому гостю лучше увидеть русский, чем пустые
 * строки локализации.
 */
const toLocale = (raw: string | undefined): string => {
  const short = (raw ?? '').slice(0, 2).toLowerCase()
  return SUPPORTED_LOCALES.has(short) ? short : 'ru'
}

/**
 * Разбирает обновление в команду «Запустить».
 *
 * Возвращает `null` на всём, что нас не касается: правки сообщений, сообщения
 * от других ботов, групповые чаты, любой текст кроме `/start`. Разбор вынесен
 * из клиента отдельной функцией именно затем, чтобы его можно было проверить
 * тестом, не поднимая сети.
 */
export const parseStart = (update: TelegramUpdate): TelegramStart | null => {
  const message = update.message
  if (message === undefined || message.chat.type !== 'private') {
    return null
  }

  const from = message.from
  if (from === undefined || from.is_bot) {
    return null
  }

  const text = message.text ?? ''
  // В личке команда приходит как `/start`, но Telegram допускает и форму
  // `/start@имя_бота` — она встречается, когда сообщение переслали из группы.
  const match = /^\/start(?:@\S+)?(?:\s+(\S+))?\s*$/.exec(text)
  if (match === null) {
    return null
  }

  const name = [from.first_name, from.last_name].filter((part) => part !== undefined).join(' ')

  return {
    updateId: update.update_id,
    userId: String(from.id),
    chatId: String(message.chat.id),
    displayName: name.length > 0 ? name : null,
    locale: toLocale(from.language_code),
    payload: match[1] ?? null,
  }
}

export class TelegramApi {
  constructor(private readonly token: string) {}

  private async call(
    method: string,
    body: unknown,
    timeoutMs: number,
    external?: AbortSignal,
  ): Promise<unknown> {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      abort.abort()
    }, timeoutMs)

    // Два повода прекратить ожидание: вышло время и нас остановили снаружи.
    // Без второго остановка сервиса ждала бы, пока Telegram отпустит запрос,
    // а он держит его до сорока пяти секунд — то есть каждый выкат вставал бы
    // на эту паузу.
    const signal =
      external === undefined ? abort.signal : AbortSignal.any([abort.signal, external])

    let response: Response

    try {
      response = await fetch(`${ORIGIN}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch {
      // Исходную ошибку намеренно не пересказываем: в ней может оказаться
      // адрес запроса, а в адресе — ключ бота.
      throw new TelegramError(method, 'сеть недоступна или ответ не дождались')
    } finally {
      clearTimeout(timer)
    }

    let payload: unknown

    try {
      payload = await response.json()
    } catch {
      throw new TelegramError(method, `ответ ${response.status} не является JSON`)
    }

    const envelope = Envelope.safeParse(payload)

    if (!envelope.success) {
      throw new TelegramError(method, `ответ не в формате Telegram (${response.status})`)
    }

    if (!envelope.data.ok) {
      // description Telegram пишет сам и ключа в нём нет — например
      // «Unauthorized» или «Conflict: terminated by other getUpdates request».
      throw new TelegramError(method, envelope.data.description ?? `отказ ${response.status}`)
    }

    return envelope.data.result
  }

  /** Кто мы. Нужно ради имени бота: из него собирается ссылка `t.me/<имя>`. */
  async getMe(): Promise<{ id: number; username: string }> {
    const parsed = Me.safeParse(await this.call('getMe', {}, 10_000))

    if (!parsed.success) {
      throw new TelegramError('getMe', 'в ответе нет имени бота')
    }

    return parsed.data
  }

  /**
   * Забирает новые сообщения, ожидая до `waitSeconds` появления первого.
   *
   * `offset` — «первое ещё не разобранное». Передавая его, мы одновременно
   * подтверждаем разбор всех предыдущих: у Telegram это одно и то же действие.
   */
  async getUpdates(
    offset: number | null,
    waitSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const result = await this.call(
      'getUpdates',
      {
        ...(offset === null ? {} : { offset }),
        timeout: waitSeconds,
        // Просим только сообщения. Всё прочее — правки, реакции, участники —
        // нам не нужно и в очереди только мешает.
        allowed_updates: ['message'],
      },
      // Ждём дольше, чем просили Telegram: разрыв по нашему таймеру раньше
      // срока превратил бы обычное затишье в поток ошибок в логе.
      (waitSeconds + 15) * 1_000,
      signal,
    )

    const parsed = z.array(Update).safeParse(result)

    if (!parsed.success) {
      throw new TelegramError('getUpdates', 'список сообщений не разобран')
    }

    return parsed.data
  }

  /** Пишет гостю в чат. Ошибку не глушим: молчащий бот — это поломка входа. */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text }, 10_000)
  }
}
