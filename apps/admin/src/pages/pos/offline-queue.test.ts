import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../shared/api/http'
import {
  enqueue,
  flushQueue,
  isNetworkFailure,
  isStuck,
  MAX_ATTEMPTS,
  readQueue,
  resetForRetry,
  type QueuedSale,
  type SaleSender,
} from './offline-queue'

/**
 * Очередь чеков при пропавшей сети. docs/03, раздел 10.
 *
 * Здесь проверяется то, что дороже всего сломать незаметно: что чек не
 * теряется, не задваивается и не крутится вечно после отказа сервера.
 */

const TENANT = '00000000-0000-4000-8000-000000000002'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff'

const sale = (over: Partial<QueuedSale> = {}): QueuedSale => ({
  receiptId: 'r-1',
  tenantId: TENANT,
  target: { kind: 'MEMBERSHIP', membershipId: 'm-1' },
  amount: 125_000,
  queuedAt: 1_000,
  attempts: 0,
  ...over,
})

/** Отправитель, который всё принимает и запоминает, что именно у него просили. */
const workingSender = (): SaleSender & { commits: Array<{ receiptId: string }> } => {
  const commits: Array<{ receiptId: string }> = []

  return {
    commits,
    findGuest: () => Promise.resolve({ membershipId: 'm-from-phone' }),
    preview: () => Promise.resolve({ previewId: 'p-1' }),
    commit: (input) => {
      commits.push({ receiptId: input.receiptId })
      return Promise.resolve({})
    },
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Различение сбоя сети и отказа сервера', () => {
  it('ответ сервера сетевым сбоем не считается', () => {
    // Разница решает судьбу чека: отказ сервера, положенный в очередь, будет
    // повторяться вечно и никогда не пройдёт.
    expect(isNetworkFailure(new ApiError(400, 'RECEIPT_REQUIRED', 'Введите номер чека'))).toBe(
      false,
    )
  })

  it('обрыв fetch считается сетевым', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('Очередь', () => {
  it('переживает перезагрузку планшета', () => {
    enqueue(sale())

    // Читаем заново, как после перезапуска браузера: очередь в localStorage,
    // а не в памяти — иначе перезагрузка страницы теряет принятые чеки.
    expect(readQueue()).toHaveLength(1)
    expect(readQueue()[0]?.receiptId).toBe('r-1')
  })

  it('повтор того же чека не задваивает запись', () => {
    enqueue(sale())
    enqueue(sale())

    expect(readQueue()).toHaveLength(1)
  })

  it('битая запись в хранилище не роняет кассу', () => {
    window.localStorage.setItem('positive.pos.queue', '{не json')

    // Планшет кассы не должен переставать работать из-за одной битой строки.
    expect(readQueue()).toEqual([])
  })

  it('целые записи переживают соседство с битой', () => {
    window.localStorage.setItem('positive.pos.queue', JSON.stringify([sale(), { мусор: true }]))

    expect(readQueue()).toHaveLength(1)
  })
})

describe('Отправка накопленного', () => {
  it('уходит с тем же ключом идемпотентности, что был выдан при приёме', async () => {
    enqueue(sale({ receiptId: 'r-keep' }))
    const sender = workingSender()

    const result = await flushQueue(sender, TENANT, 2_000)

    // Ключ обязан быть исходным: только он не даёт начислить дважды, если
    // чек на самом деле дошёл, а ответ потерялся.
    expect(sender.commits).toEqual([{ receiptId: 'r-keep' }])
    expect(result.sent).toBe(1)
    expect(readQueue()).toHaveLength(0)
  })

  it('чек по телефону сначала находит гостя, потом проводится', async () => {
    enqueue(sale({ target: { kind: 'PHONE', phone: '+66812345678' } }))
    const sender = workingSender()
    const preview = vi.spyOn(sender, 'preview')

    await flushQueue(sender, TENANT, 2_000)

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ membershipId: 'm-from-phone' }))
  })

  it('ЧЕК БЕЗ ПРЕДРАСЧЁТА ИДЁТ «БЕЗ СКИДКИ», ПОДТВЕРЖДЁННЫЙ — СО СКИДКОЙ', async () => {
    // Гость, чей чек ушёл в очередь до предрасчёта, заплатил полную цену: сервер
    // начислит ему баллы вместо скидки. Кассир, видевший скидку, её уже дал.
    enqueue(sale({ receiptId: 'r-blind' }))
    enqueue(sale({ receiptId: 'r-seen', queuedAt: 2_000, discountGiven: true }))
    const sender = workingSender()
    const preview = vi.spyOn(sender, 'preview')

    await flushQueue(sender, TENANT, 3_000)

    expect(preview.mock.calls.map(([input]) => input.withoutDiscount)).toEqual([true, undefined])
  })

  it('чек уходит в том же порядке, в каком его пробили', async () => {
    enqueue(sale({ receiptId: 'r-1', queuedAt: 1_000 }))
    enqueue(sale({ receiptId: 'r-2', queuedAt: 2_000 }))
    const sender = workingSender()

    await flushQueue(sender, TENANT, 3_000)

    // Порядок сверяется с бумажной лентой кассы при разборе.
    expect(sender.commits.map((item) => item.receiptId)).toEqual(['r-1', 'r-2'])
  })

  it('сбой сети оставляет чек в очереди и останавливает проход', async () => {
    enqueue(sale({ receiptId: 'r-1' }))
    enqueue(sale({ receiptId: 'r-2' }))

    const sender = workingSender()
    sender.commit = () => Promise.reject(new TypeError('Failed to fetch'))

    const result = await flushQueue(sender, TENANT, 2_000)

    expect(result.sent).toBe(0)
    expect(readQueue()).toHaveLength(2)
    // Второй чек даже не пробовали: сети нет, попытка сожгла бы счётчик зря.
    expect(readQueue()[1]?.attempts).toBe(0)
    expect(readQueue()[0]?.attempts).toBe(1)
  })

  it('отказ сервера не повторяется, а выносится кассиру', async () => {
    enqueue(sale())

    const sender = workingSender()
    sender.commit = () => Promise.reject(new ApiError(422, 'BALANCE_CHANGED', 'Баланс изменился'))

    const result = await flushQueue(sender, TENANT, 2_000)

    expect(result.failed).toBe(1)
    // Чек остаётся в очереди, но помечен застрявшим: его разбирает человек,
    // а не бесконечный фоновый повтор.
    const stuck = readQueue()[0]
    expect(stuck).toBeDefined()
    expect(isStuck(stuck as QueuedSale)).toBe(true)
    expect(stuck?.lastError).toBe('Баланс изменился')
  })

  it('чужое заведение не трогает', async () => {
    enqueue(sale({ receiptId: 'r-own' }))
    enqueue(sale({ receiptId: 'r-foreign', tenantId: OTHER_TENANT }))
    const sender = workingSender()

    const result = await flushQueue(sender, TENANT, 2_000)

    // На планшете сменился сотрудник: чужой чек не наш, но и выбрасывать его
    // нельзя — он уйдёт, когда вернётся его смена.
    expect(sender.commits.map((item) => item.receiptId)).toEqual(['r-own'])
    expect(result.left).toBe(0)
    expect(readQueue().map((item) => item.receiptId)).toEqual(['r-foreign'])
  })

  it('исчерпанные попытки помечают чек застрявшим', () => {
    expect(isStuck(sale({ attempts: MAX_ATTEMPTS }))).toBe(true)
    expect(isStuck(sale({ attempts: MAX_ATTEMPTS - 1 }))).toBe(false)
  })
})

describe('Застрявший чек в руках кассира', () => {
  it('«повторить» обнуляет попытки, стирает причину и вписывает номер чека', () => {
    enqueue(sale({ attempts: MAX_ATTEMPTS, lastError: 'Номер чека обязателен' }))
    enqueue(sale({ receiptId: 'r-2', attempts: 3 }))

    const [first, second] = resetForRetry('r-1', ' A-42 ')

    expect(first).toEqual({ ...sale(), attempts: 0, receiptNumber: 'A-42' })
    expect(first !== undefined && 'lastError' in first).toBe(false)
    // Соседний чек не тронут.
    expect(second?.attempts).toBe(3)
    expect(readQueue().filter(isStuck)).toHaveLength(0)
  })

  it('пустой номер прежний номер не стирает', () => {
    enqueue(sale({ attempts: MAX_ATTEMPTS, receiptNumber: 'B-1' }))

    expect(resetForRetry('r-1', '   ')[0]?.receiptNumber).toBe('B-1')
  })
})
