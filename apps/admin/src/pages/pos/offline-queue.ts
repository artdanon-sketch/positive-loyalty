import { POS_QUEUE_MAX_ATTEMPTS } from '@positive/contracts'

import { ApiError } from '../../shared/api/http'

/**
 * Очередь чеков, не ушедших из-за сети. docs/03, раздел 10:
 * «работает при пропавшей сети: операция уходит в локальную очередь
 * с ключом идемпотентности».
 *
 * ЧТО ИМЕННО КЛАДЁТСЯ В ОЧЕРЕДЬ — главное решение этого файла. Не результат
 * расчёта: посчитать начисление на клиенте значит завести вторую правду
 * о деньгах, и однажды она разойдётся с той, что в `LedgerService`. В очередь
 * ложится НАМЕРЕНИЕ: кому, сколько, по какому чеку. Расчёт делает сервер,
 * когда связь вернётся, — теми же ставками, что и всегда.
 *
 * Отсюда и цена решения, о которой лучше знать заранее: пока чек лежит
 * в очереди, точная сумма начисления неизвестна ни кассиру, ни гостю. Поэтому
 * ТЗ и требует говорить гостю «баллы придут в течение нескольких минут»,
 * а не называть цифру. Назвать её можно было бы только угадав, а угадывать
 * про чужие деньги нельзя.
 *
 * Ключ идемпотентности (`receiptId`) выдаётся ОДИН РАЗ при постановке в очередь
 * и не меняется между попытками. Поэтому чек, который на самом деле дошёл
 * до сервера, но ответ потерялся, не начислится второй раз: повтор вернёт
 * первый ответ (docs/02, раздел 3.3).
 */

const STORAGE_KEY = 'positive.pos.queue'

/**
 * Сколько раз пробуем, прежде чем признать чек застрявшим и позвать человека.
 * Число живёт в контракте: тот же порог сервер применяет к списку владельца.
 */
export const MAX_ATTEMPTS = POS_QUEUE_MAX_ATTEMPTS

/**
 * Кого начислять.
 *
 * `MEMBERSHIP` — гость уже был найден до того, как связь пропала: искать
 * повторно нечего и незачем. `PHONE` — связь пропала раньше, на самом поиске;
 * тогда при повторе цепочка проходится целиком.
 *
 * QR-токена здесь нет намеренно: он живёт пять минут (docs/02, раздел 2.2),
 * и к моменту, когда сеть вернётся, окажется просроченным. Класть в очередь
 * заведомо протухающий ключ — значит обещать кассиру то, что не сбудется.
 */
export type QueuedTarget =
  | { readonly kind: 'MEMBERSHIP'; readonly membershipId: string }
  | { readonly kind: 'PHONE'; readonly phone: string }

export interface QueuedSale {
  /** Ключ идемпотентности. Выдаётся один раз и переживает все попытки. */
  readonly receiptId: string
  /** Чей это чек. Очередь лежит на устройстве, а устройство принадлежит заведению. */
  readonly tenantId: string
  readonly target: QueuedTarget
  /** Сумма чека в минорных единицах. */
  readonly amount: number
  readonly receiptNumber?: string
  readonly queuedAt: number
  readonly attempts: number
  /** Последняя причина неудачи — её видит кассир в списке застрявших. */
  readonly lastError?: string
}

const isQueuedSale = (value: unknown): value is QueuedSale => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const sale = value as Partial<QueuedSale>

  return (
    typeof sale.receiptId === 'string' &&
    typeof sale.tenantId === 'string' &&
    typeof sale.amount === 'number' &&
    typeof sale.queuedAt === 'number' &&
    typeof sale.attempts === 'number' &&
    typeof sale.target === 'object' &&
    sale.target !== null
  )
}

/**
 * Чтение очереди.
 *
 * Любая порча хранилища трактуется как пустая очередь, а не как повод упасть:
 * планшет кассы не должен переставать работать из-за одной битой строки
 * в localStorage. Но и молча терять чеки нельзя — поэтому битые записи
 * отфильтровываются поштучно, а целые остаются.
 */
export function readQueue(): QueuedSale[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw === null) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed.filter(isQueuedSale) : []
  } catch {
    return []
  }
}

function writeQueue(sales: readonly QueuedSale[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sales))
  } catch {
    // Приватный режим или переполненное хранилище. Терять уже принятый чек
    // нельзя, но и падать посреди смены — тоже: очередь останется в памяти
    // до перезагрузки страницы, а кассир увидит её в списке.
  }
}

/** Ставит чек в очередь. Повтор с тем же `receiptId` не задваивает запись. */
export function enqueue(sale: QueuedSale): QueuedSale[] {
  const queue = readQueue()

  if (queue.some((item) => item.receiptId === sale.receiptId)) {
    return queue
  }

  const next = [...queue, sale]
  writeQueue(next)
  return next
}

export function dequeue(receiptId: string): QueuedSale[] {
  const next = readQueue().filter((item) => item.receiptId !== receiptId)
  writeQueue(next)
  return next
}

function update(receiptId: string, patch: Partial<QueuedSale>): QueuedSale[] {
  const next = readQueue().map((item) =>
    item.receiptId === receiptId ? { ...item, ...patch } : item,
  )
  writeQueue(next)
  return next
}

/**
 * Вернуть застрявший чек в работу: попытки с нуля, прежняя причина стёрта.
 *
 * Номер чека можно вписать или исправить: самая частая причина отказа —
 * «номер чека обязателен», когда владелец включил это правило, пока чек
 * лежал в очереди. Пустой номер прежний не стирает.
 */
export function resetForRetry(receiptId: string, receiptNumber?: string): QueuedSale[] {
  const number = receiptNumber?.trim() ?? ''

  const next = readQueue().map((item) => {
    if (item.receiptId !== receiptId) {
      return item
    }

    // Причина уходит целиком, а не становится пустым ключом в хранилище.
    const { lastError: _stale, ...rest } = item
    return { ...rest, attempts: 0, ...(number === '' ? {} : { receiptNumber: number }) }
  })

  writeQueue(next)
  return next
}

/**
 * Сетевой ли это сбой.
 *
 * РАЗЛИЧИЕ КРИТИЧНОЕ. `ApiError` означает, что сервер ответил и отказал:
 * не тот номер чека, сумма выше потолка, чужое участие. Такой чек в очередь
 * класть нельзя — он будет повторяться вечно и никогда не пройдёт. Всё
 * остальное (fetch бросает `TypeError`) — это сеть, и вот его повторять нужно.
 */
export const isNetworkFailure = (error: unknown): boolean => !(error instanceof ApiError)

/** Что делает одна попытка отправки. Вынесено, чтобы очередь не знала про HTTP. */
export interface SaleSender {
  findGuest: (target: QueuedTarget) => Promise<{ membershipId: string }>
  preview: (input: {
    membershipId: string
    amount: number
    receiptNumber?: string
  }) => Promise<{ previewId: string }>
  commit: (input: { previewId: string; receiptId: string }) => Promise<unknown>
}

export interface FlushResult {
  readonly sent: number
  readonly failed: number
  readonly left: number
}

/**
 * Пытается отправить всё, что накопилось.
 *
 * Порядок — как пробивали: чек, пробитый раньше, уходит раньше. Это не
 * педантизм, а сверка с бумажной лентой кассы при разборе.
 *
 * Первая же сетевая неудача ОСТАНАВЛИВАЕТ проход: если сеть не вернулась,
 * остальные попытки только сожгут счётчик и приблизят чеки к «застрял».
 */
export async function flushQueue(
  sender: SaleSender,
  tenantId: string,
  now: number,
): Promise<FlushResult> {
  let sent = 0
  let failed = 0

  for (const sale of readQueue()) {
    // Чужое заведение: на планшете сменился сотрудник. Чек не наш — не трогаем,
    // но и не выбрасываем: он уйдёт, когда вернётся его смена.
    if (sale.tenantId !== tenantId) {
      continue
    }

    try {
      const target =
        sale.target.kind === 'MEMBERSHIP'
          ? sale.target
          : ({
              kind: 'MEMBERSHIP',
              membershipId: (await sender.findGuest(sale.target)).membershipId,
            } as const)

      const preview = await sender.preview({
        membershipId: target.membershipId,
        amount: sale.amount,
        ...(sale.receiptNumber === undefined ? {} : { receiptNumber: sale.receiptNumber }),
      })

      await sender.commit({ previewId: preview.previewId, receiptId: sale.receiptId })

      dequeue(sale.receiptId)
      sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (isNetworkFailure(error)) {
        update(sale.receiptId, { attempts: sale.attempts + 1, lastError: message })
        // Сети всё ещё нет. Остальные чеки ждут вместе с этим.
        break
      }

      // Сервер отказал. Повторять бессмысленно: ответ не изменится сам собой,
      // и чек обязан попасть кассиру на глаза, а не крутиться в фоне.
      update(sale.receiptId, { attempts: MAX_ATTEMPTS, lastError: message })
      failed += 1
    }
  }

  const left = readQueue().filter((item) => item.tenantId === tenantId).length

  // `now` принимается аргументом, а не берётся из Date.now(): так функцию
  // можно проверить тестом на любой момент времени, не подменяя часы процесса.
  void now

  return { sent, failed, left }
}

/** Застрявшие: попытки исчерпаны либо сервер отказал. Их разбирает человек. */
export const isStuck = (sale: QueuedSale): boolean => sale.attempts >= MAX_ATTEMPTS
