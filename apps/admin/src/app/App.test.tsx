import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../shared/i18n'
import { App } from './App'

/**
 * Поток бэк-офиса: без сессии — вход, после входа — оболочка с навигацией.
 *
 * Сервер подменяется на уровне fetch: компонентные тесты проверяют экран,
 * а не сеть — контракт API исчерпывающе проверяют интеграционные тесты API.
 */

const TOKENS_RESPONSE = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresIn: 28_800,
  subject: {
    staffId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Менеджер Анна',
    role: 'MANAGER',
    tenantId: '00000000-0000-4000-8000-000000000002',
  },
}

const EMPTY_LEDGER = { items: [], total: 0 }

/** Заведение требует номер чека — как Kata Beach Kitchen в демо-данных. */
const POS_CONFIG = { requireReceiptNumber: true, maxManualAmount: 300_000, allowManualEntry: true }

const POS_GUEST = {
  guestId: '55555555-5555-4555-8555-555555555555',
  membershipId: '66666666-6666-4666-8666-666666666666',
  displayName: 'Анна Ковалёва',
  isNew: false,
  mode: 'TOURIST',
  points: 30_175,
  visitsTotal: 4,
  avgCheck: 150_875,
  isControlGroup: false,
}

const POS_PREVIEW = {
  previewId: '77777777-7777-4777-8777-777777777777',
  expiresAt: '2026-08-27T12:00:00.000Z',
  amount: 125_000,
  maxRedeemable: 30_175,
  redeem: 0,
  amountToPay: 125_000,
  pointsToEarn: 6_250,
  balanceAtPreview: 30_175,
}

const POS_COMMIT = {
  transactionId: '88888888-8888-4888-8888-888888888888',
  redeemed: 0,
  earned: 6_250,
  newBalance: 36_425,
  replayed: false,
}

/**
 * Дашборд с данными. Числа разные во всех полях намеренно: одинаковые
 * значения прячут перепутанные местами поля — тест прошёл бы и на них.
 */
const DASHBOARD = {
  period: '7d',
  guestsViaProgram: { value: 147, prev: 124, changePct: 18.5, newGuests: 38 },
  pointsLiability: { value: 1_240_000, prev: 1_198_000 },
  series: [
    { date: '2026-08-24', new: 3, returning: 14 },
    { date: '2026-08-25', new: 5, returning: 21 },
  ],
  hourly: [
    { hour: 12, guests: 8 },
    { hour: 13, guests: 1 },
    { hour: 14, guests: 0.5 },
    { hour: 15, guests: 0.5 },
    { hour: 16, guests: 9 },
  ],
  advice: [{ kind: 'SLEEPING_GUESTS', guests: 26 }],
  isPartialPeriod: false,
  isEmpty: false,
}

/** Заведение первого дня: плиток нет, вместо них онбординг-чеклист. */
const DASHBOARD_EMPTY = {
  ...DASHBOARD,
  guestsViaProgram: { value: 0, prev: 0, changePct: null, newGuests: 0 },
  pointsLiability: { value: 0, prev: 0 },
  series: [],
  hourly: [],
  advice: [],
  isEmpty: true,
}

/**
 * Виды продаж заведения. Выключенный в списке НАМЕРЕННО: бэк-офис обязан
 * его показывать (чтобы вернуть в работу), а касса — не предлагать.
 */
const ABONEMENT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Абонемент на 10 занятий',
  sortOrder: 0,
  isActive: true,
}

const SALE_KINDS = [
  ABONEMENT,
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Разовое занятие',
    sortOrder: 1,
    isActive: true,
  },
]

const SALE_KINDS_WITH_OFF = [
  ...SALE_KINDS,
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Сертификат', sortOrder: 2, isActive: false },
]

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Разбор пары url/init независимо от формы вызова fetch. */
const requestOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Обрыв сети, а не ответ сервера. Ровно так ведёт себя fetch, когда планшет
 * потерял связь, — и по этому различию касса решает, класть ли чек в очередь.
 */
const OFFLINE = Symbol('offline')

/**
 * Ответ-поток в формате SSE.
 *
 * Живая лента читает `text/event-stream` кусками через `fetch`, а не
 * `EventSource`: тот не умеет заголовки, и токен пришлось бы класть в адрес.
 * Здесь поток отдаётся так же, как его отдаёт сервер, — событиями, разделёнными
 * пустой строкой, — чтобы проверялся настоящий разбор, а не его имитация.
 */
const sseResponse = (chunks: readonly string[]): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      // Поток НЕ закрываем: живой он и есть открытый. Закрытие тут выглядело
      // бы как обрыв связи, и лента ушла бы в переподключение.
    },
  })

  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const FEED_EVENT = {
  id: '99999999-9999-4999-8999-999999999999',
  kind: 'ledger.earned',
  masked: 'А***',
  amount: 6_250,
  basis: 125_000,
  at: '2026-08-27T13:28:26.597Z',
}

const stubApi = (
  overrides: Partial<Record<string, (init?: RequestInit) => Response | typeof OFFLINE>> = {},
): ReturnType<typeof vi.fn> => {
  const handler = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestOf(input)
    const path = url.replace(/^https?:\/\/[^/]+/, '')

    for (const [prefix, respond] of Object.entries(overrides)) {
      if (path.startsWith(prefix) && respond !== undefined) {
        const outcome = respond(init)
        return outcome === OFFLINE
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(outcome)
      }
    }

    if (path.startsWith('/v1/auth/staff/pin')) {
      return Promise.resolve(json(TOKENS_RESPONSE))
    }
    if (path.startsWith('/v1/pos/config')) {
      return Promise.resolve(json(POS_CONFIG))
    }
    if (path.startsWith('/v1/pos/guest')) {
      return Promise.resolve(json(POS_GUEST))
    }
    if (path.startsWith('/v1/pos/transactions/preview')) {
      return Promise.resolve(json(POS_PREVIEW))
    }
    if (path.startsWith('/v1/pos/transactions/commit')) {
      return Promise.resolve(json(POS_COMMIT))
    }
    if (path.includes('/void')) {
      return Promise.resolve(
        json({
          transactionId: POS_COMMIT.transactionId,
          reversals: [],
          newBalance: 30_175,
          replayed: false,
        }),
      )
    }
    if (path.startsWith('/v1/admin/dashboard')) {
      return Promise.resolve(json(DASHBOARD))
    }
    if (path.startsWith('/v1/admin/ledger')) {
      return Promise.resolve(json(EMPTY_LEDGER))
    }
    if (path.startsWith('/v1/admin/guests')) {
      return Promise.resolve(json({ items: [], total: 0 }))
    }
    if (path.startsWith('/v1/admin/sale-kinds')) {
      return Promise.resolve(json(SALE_KINDS_WITH_OFF))
    }
    if (path.startsWith('/v1/pos/sale-kinds')) {
      return Promise.resolve(json(SALE_KINDS))
    }

    return Promise.resolve(
      json({ error: { code: 'NOT_FOUND', message: `нет обработчика для ${path}` } }, 404),
    )
  })

  vi.stubGlobal('fetch', handler)
  return handler
}

const fillAndSubmitLogin = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText(t('login.device')), {
    target: { value: 'demo-kata-manager' },
  })
  fireEvent.change(screen.getByLabelText(t('login.pin')), { target: { value: '4207' } })
  fireEvent.click(screen.getByRole('button', { name: t('login.submit') }))
}

describe('App', () => {
  it('без сохранённой сессии показывает экран входа', async () => {
    stubApi()
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: t('login.title') }),
    ).toBeInTheDocument()
    // Экрана «Обзор» без входа быть не должно: бэк-офис закрыт целиком.
    expect(screen.queryByRole('heading', { name: t('overview.title') })).not.toBeInTheDocument()
  })

  it('после входа открывает оболочку с навигацией и именем сотрудника', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('link', { name: t('nav.guests') })).toBeInTheDocument()
    expect(screen.getByText(TOKENS_RESPONSE.subject.displayName)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: t('overview.title') })).toBeInTheDocument()
  })

  it('отказ сервера показывает его сообщение, не выдумывая причин', async () => {
    stubApi({
      '/v1/auth/staff/pin': () =>
        json({ error: { code: 'UNAUTHORIZED', message: 'Не удалось войти' } }, 401),
    })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось войти')
    // Остались на входе.
    expect(screen.getByRole('heading', { level: 1, name: t('login.title') })).toBeInTheDocument()
  })

  it('переключает тему на противоположную прямо с экрана входа', async () => {
    stubApi()
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: t('login.title') })
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBeNull()
    })

    const before = document.documentElement.getAttribute('data-theme')
    fireEvent.click(screen.getByRole('button', { name: t('theme.toggle.label') }))

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBe(before)
    })
  })
})

describe('Обзор', () => {
  it('показывает три ответа владельцу: гостей, обязательство и дельту', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByText('147')).toBeInTheDocument()
    // Обязательство хранится целым в сатангах, показывается в батах.
    expect(screen.getByText('12 400,00 ฿')).toBeInTheDocument()
    expect(screen.getByText('↑ +18.5%')).toBeInTheDocument()
    // Формулировка задана ТЗ дословно — она и продаёт смысл цифры.
    expect(screen.getByText(t('overview.tile.liabilityHint'))).toBeInTheDocument()
  })

  it('заведение первого дня видит онбординг вместо плиток', async () => {
    stubApi({ '/v1/admin/dashboard': () => json(DASHBOARD_EMPTY) })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByText(t('overview.empty.title'))).toBeInTheDocument()
    expect(screen.queryByText(t('overview.tile.liability'))).not.toBeInTheDocument()
  })

  it('совет показывается карточкой с одним действием', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    // 26 по-русски — форма «many»: «26 гостей не заходили».
    expect(await screen.findByText(`26 ${t('overview.advice.sleeping.many')}`)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: t('overview.advice.sleeping.action') }),
    ).toBeInTheDocument()
  })

  it('без советов блок скрывается целиком, а не хвалит', async () => {
    // ТЗ прямо запрещает показывать «всё хорошо»: похвала вместо задачи
    // обесценивает блок, и настоящий совет потом пройдёт мимо.
    stubApi({ '/v1/admin/dashboard': () => json({ ...DASHBOARD, advice: [] }) })
    render(<App />)

    await fillAndSubmitLogin()

    await screen.findByText('147')
    expect(screen.queryByText(t('overview.advice.title'))).not.toBeInTheDocument()
  })

  it('график переключается на таблицу и обратно', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.click(await screen.findByRole('button', { name: t('overview.days.asTable') }))

    expect(
      screen.getByRole('columnheader', { name: t('overview.days.col.date') }),
    ).toBeInTheDocument()
    expect(screen.getByText('25.08')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('overview.days.asChart') }))
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
  })

  it('смена периода запрашивает выбранный период у сервера', async () => {
    const fetchMock = stubApi()
    render(<App />)

    await fillAndSubmitLogin()
    await screen.findByText('147')

    fireEvent.click(screen.getByRole('button', { name: t('overview.period.30d') }))

    await waitFor(() => {
      const asked = fetchMock.mock.calls.some(([input]) =>
        requestOf(input as RequestInfo | URL).includes('period=30d'),
      )
      expect(asked).toBe(true)
    })
  })
})

describe('Формы слова по числу', () => {
  // docs/04, раздел 7: в русском три формы. Одна строка на все числа даёт
  // «21 гостей не заходили» — это не опечатка, а ошибка языка, и владелец
  // её замечает. Формы выбирает Intl.PluralRules, библиотеку ICU не тянем.
  it.each([
    [1, 'one'],
    [21, 'one'],
    [3, 'few'],
    [22, 'few'],
    [5, 'many'],
    [26, 'many'],
  ] as const)('%i гостей — форма %s', async (guests, form) => {
    stubApi({
      '/v1/admin/dashboard': () =>
        json({ ...DASHBOARD, advice: [{ kind: 'SLEEPING_GUESTS', guests }] }),
    })
    render(<App />)

    await fillAndSubmitLogin()

    const expected = `${guests} ${t(`overview.advice.sleeping.${form}`)}`
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })
})

/** Вход кассира: те же поля, другой ответ сервера. */
const CASHIER_TOKENS = {
  ...TOKENS_RESPONSE,
  subject: { ...TOKENS_RESPONSE.subject, displayName: 'Кассир смены А', role: 'CASHIER' },
}

describe('Касса', () => {
  it('кассир попадает сразу на кассу, а не на закрытый ему обзор', async () => {
    // «Обзор» кассиру закрыт на API и ответил бы отказом. Отправлять человека
    // на неработающий для него экран — худший первый кадр смены.
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    expect(
      await screen.findByRole('heading', { level: 1, name: t('pos.title') }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('nav.guests') })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('nav.overview') })).not.toBeInTheDocument()
  })

  it('менеджеру касса доступна, а его экраны остаются на месте', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('link', { name: t('nav.pos') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('nav.guests') })).toBeInTheDocument()
  })

  it('проводит чек: гость по телефону, сумма, подтверждение, результат', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))

    // Гость найден — на экране то, что кассир должен знать до ввода суммы.
    expect(await screen.findByText(POS_GUEST.displayName)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('pos.amount.label')), { target: { value: '1250' } })
    // Заведение требует номер чека, и поле подписано как обязательное:
    // кассир узнаёт об этом ДО отказа сервера, а не после.
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-1001' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))

    // Начисление показано ДО проведения: кассир называет сумму вслух.
    expect(await screen.findByText('62,50 ฿')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('pos.confirm.submit') }))

    // Экран успеха показывает, ЧТО ИМЕННО получил гость, а не галочку.
    expect(await screen.findByText('+62,50 ฿')).toBeInTheDocument()
    expect(screen.getByText('364,25 ฿')).toBeInTheDocument()
  })

  it('КАССИР ВЫБИРАЕТ ВИД ПРОДАЖИ, И ОН УХОДИТ НА СЕРВЕР', async () => {
    // Ради этого поля заведён весь справочник: без него партнёрское условие
    // «купил абонемент» не отличит абонемент от ужина на ту же сумму.
    const fetchMock = stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    expect(await screen.findByText(POS_GUEST.displayName)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('pos.amount.label')), { target: { value: '1250' } })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-2001' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))

    const select = await screen.findByLabelText(t('pos.saleKind.label'))
    fireEvent.change(select, { target: { value: ABONEMENT.id } })
    fireEvent.click(screen.getByRole('button', { name: t('pos.confirm.submit') }))

    await waitFor(() => {
      const commit = fetchMock.mock.calls.find(([input]) =>
        requestOf(input as RequestInfo | URL).includes('/transactions/commit'),
      )
      expect(commit).toBeDefined()
      const body = JSON.parse((commit?.[1] as RequestInit).body as string) as {
        saleKindId?: string
      }
      expect(body.saleKindId).toBe(ABONEMENT.id)
    })
  })

  it('без выбора вида чек уходит БЕЗ поля, а не с пустой строкой', async () => {
    // Пустая строка не uuid: сервер отверг бы такой чек валидацией, и кассир
    // получил бы отказ за то, что просто ничего не выбрал.
    const fetchMock = stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    expect(await screen.findByText(POS_GUEST.displayName)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('pos.amount.label')), { target: { value: '1250' } })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-2002' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))

    expect(await screen.findByLabelText(t('pos.saleKind.label'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('pos.confirm.submit') }))

    await waitFor(() => {
      const commit = fetchMock.mock.calls.find(([input]) =>
        requestOf(input as RequestInfo | URL).includes('/transactions/commit'),
      )
      expect(commit).toBeDefined()
      const body = JSON.parse((commit?.[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >
      expect('saleKindId' in body).toBe(false)
    })
  })

  it('где справочника нет, касса выбор не показывает вовсе', async () => {
    // Пустой список — норма, а не ошибка. Пустой выпадающий список посреди
    // кассы был бы вопросом без ответов.
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/sale-kinds': () => json([]),
    })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    expect(await screen.findByText(POS_GUEST.displayName)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('pos.amount.label')), { target: { value: '1250' } })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-2003' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))

    expect(await screen.findByRole('button', { name: t('pos.confirm.submit') })).toBeInTheDocument()
    expect(screen.queryByLabelText(t('pos.saleKind.label'))).not.toBeInTheDocument()
  })

  it('бэк-офис показывает и выключенные виды продаж', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.click(await screen.findByRole('link', { name: t('nav.saleKinds') }))

    expect(await screen.findByText('Абонемент на 10 занятий')).toBeInTheDocument()
    // Выключенный обязан быть виден: иначе его нельзя вернуть в работу,
    // и владелец заведёт второй такой же под тем же именем — а UNIQUE не даст.
    expect(screen.getByText('Сертификат')).toBeInTheDocument()
    expect(screen.getByText(t('saleKinds.state.off'))).toBeInTheDocument()
  })

  it('ПОЛЕ НОВОГО ВИДА НЕ ОЧИЩАЕТСЯ, ЕСЛИ СЕРВЕР ОТКАЗАЛ', async () => {
    // Название занято — человек правит одно слово, а не набирает всё заново.
    stubApi({
      '/v1/admin/sale-kinds': (init) =>
        init?.method === 'POST'
          ? json({ error: { code: 'SALE_KIND_EXISTS', message: 'Такое название уже есть' } }, 400)
          : json(SALE_KINDS_WITH_OFF),
    })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.click(await screen.findByRole('link', { name: t('nav.saleKinds') }))

    const input = await screen.findByLabelText(t('saleKinds.new.label'))
    fireEvent.change(input, { target: { value: 'Абонемент на 10 занятий' } })
    fireEvent.click(screen.getByRole('button', { name: t('saleKinds.new.submit') }))

    expect(await screen.findByText('Такое название уже есть')).toBeInTheDocument()
    expect(input).toHaveValue('Абонемент на 10 занятий')
  })

  it('отменяет проведённый чек в своём окне', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '1250' },
    })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-1002' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))
    fireEvent.click(await screen.findByRole('button', { name: t('pos.confirm.submit') }))

    // Кнопка отмены подписана оставшимся временем: кассир видит, сколько есть.
    const undo = await screen.findByRole('button', { name: /^Отменить/ })
    fireEvent.click(undo)

    expect(await screen.findByText(t('pos.done.voided'))).toBeInTheDocument()
  })

  it('отказ сервера на поиске гостя показывается его словами', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/guest': () =>
        json({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } }, 404),
    })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66800000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Гость не найден')
  })
})

describe('Правила кассы приезжают с сервера', () => {
  it('обязательный номер чека помечен обязательным, а не «необязательно»', async () => {
    // До этого поле было подписано «необязательно», кассир его пропускал,
    // и сервер отвечал RECEIPT_REQUIRED — при госте у стойки.
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))

    expect(await screen.findByLabelText(t('pos.receipt.required'))).toBeRequired()
    expect(screen.queryByLabelText(t('pos.receipt.label'))).not.toBeInTheDocument()
  })

  it('без номера чека кнопка расчёта заблокирована', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '1250' },
    })

    expect(screen.getByRole('button', { name: t('pos.amount.next') })).toBeDisabled()
  })

  it('сумма выше потолка ручного ввода останавливает кассира на месте', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '9999' },
    })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-1003' },
    })

    expect(await screen.findByText(/3 000,00 ฿/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('pos.amount.next') })).toBeDisabled()
  })
})

describe('Касса при пропавшей сети', () => {
  it('обрыв на проведении принимает чек в очередь, а не отказывает', async () => {
    // Гость стоит у стойки. Отказать ему потому, что на острове моргнул
    // интернет, нельзя — чек принимается и досылается (docs/03, раздел 10).
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/commit': () => OFFLINE,
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '1250' },
    })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'B-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))
    fireEvent.click(await screen.findByRole('button', { name: t('pos.confirm.submit') }))

    expect(await screen.findByText(t('pos.queued.title'))).toBeInTheDocument()
    // Сумму НЕ называем: её считает сервер, назвать сейчас можно только угадав.
    expect(screen.getByText(t('pos.queued.hint'))).toBeInTheDocument()
    expect(screen.queryByText('+62,50 ฿')).not.toBeInTheDocument()
  })

  it('отложенный чек сохраняет номер, которого требует заведение', async () => {
    // Баг, найденный вживую: при откладывании на шаге проведения номер чека
    // терялся, и повтор падал на RECEIPT_REQUIRED — чек застревал навсегда,
    // а кассиру уже сказали «принят».
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/commit': () => OFFLINE,
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '1250' },
    })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'C-77' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))
    fireEvent.click(await screen.findByRole('button', { name: t('pos.confirm.submit') }))

    await screen.findByText(t('pos.queued.title'))

    const queued = JSON.parse(window.localStorage.getItem('positive.pos.queue') ?? '[]') as Array<{
      receiptNumber?: string
    }>
    expect(queued[0]?.receiptNumber).toBe('C-77')
  })

  it('обрыв на поиске гостя даёт принять чек по телефону вслепую', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/guest': () => OFFLINE,
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))

    // Ни имени, ни баланса показать нечем — и экран об этом честно говорит.
    expect(await screen.findByText(t('pos.offline.blind'))).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '900' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.offline.accept') }))

    expect(await screen.findByText(t('pos.queued.title'))).toBeInTheDocument()
  })

  it('отказ сервера в очередь не попадает — его показывают кассиру', async () => {
    // Иначе чек крутился бы в фоне вечно и никогда не прошёл.
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/guest': () =>
        json({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } }, 404),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66800000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Гость не найден')
    expect(screen.queryByText(t('pos.offline.blind'))).not.toBeInTheDocument()
  })
})

describe('Судьба отложенного чека на экране', () => {
  it('когда чек ушёл, экран перестаёт говорить «связи нет»', async () => {
    // Связь на острове возвращается через секунды. Застывшее «связи нет»
    // на экране, с которого чек уже ушёл, заставит кассира обещать гостю
    // ожидание того, что уже случилось.
    let offline = true

    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/commit': () => (offline ? OFFLINE : json(POS_COMMIT)),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    fireEvent.change(await screen.findByLabelText(t('pos.amount.label')), {
      target: { value: '1250' },
    })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'D-9' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))
    fireEvent.click(await screen.findByRole('button', { name: t('pos.confirm.submit') }))

    expect(await screen.findByText(t('pos.queued.hint'))).toBeInTheDocument()

    // Связь вернулась — очередь уходит сама, без действий кассира.
    offline = false
    fireEvent(window, new Event('online'))

    expect(await screen.findByText(t('pos.queued.sent'))).toBeInTheDocument()
    expect(screen.queryByText(t('pos.queued.hint'))).not.toBeInTheDocument()
  })
})

describe('Живая лента', () => {
  it('показывает начисление, пришедшее потоком', async () => {
    stubApi({
      '/v1/admin/stream': () =>
        sseResponse([
          // Сердцебиение и событие в одном куске: разбор обязан пережить
          // и то, что событий несколько, и то, что среди них есть служебные.
          ': ping\n\n',
          `data: ${JSON.stringify(FEED_EVENT)}\n\n`,
        ]),
    })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByText('А***')).toBeInTheDocument()
    expect(screen.getByText('+62,50 ฿')).toBeInTheDocument()
  })

  it('событие, разорванное на два куска, собирается обратно', async () => {
    // Сеть режет поток где придётся. Половина события в буфере — норма,
    // и разбор обязан дождаться второй половины, а не выбросить первую.
    const payload = `data: ${JSON.stringify(FEED_EVENT)}\n\n`
    const cut = Math.floor(payload.length / 2)

    stubApi({
      '/v1/admin/stream': () => sseResponse([payload.slice(0, cut), payload.slice(cut)]),
    })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByText('А***')).toBeInTheDocument()
  })

  it('незнакомое событие не роняет ленту', async () => {
    // На сервере появится второй вид события раньше, чем этот экран о нём
    // узнает. Пропустить незнакомое правильнее, чем упасть.
    stubApi({
      '/v1/admin/stream': () =>
        sseResponse([
          'data: {"kind":"ledger.something.new","чего":"не знаем"}\n\n',
          `data: ${JSON.stringify(FEED_EVENT)}\n\n`,
        ]),
    })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByText('А***')).toBeInTheDocument()
  })

  it('пока событий нет, лента говорит, что ждёт, а не молчит', async () => {
    stubApi({ '/v1/admin/stream': () => sseResponse([]) })
    render(<App />)

    await fillAndSubmitLogin()

    // Молчащая и сломанная лента иначе выглядели бы одинаково.
    expect(await screen.findByText(t('overview.feed.waiting'))).toBeInTheDocument()
  })
})

const OWNER_TOKENS = {
  ...TOKENS_RESPONSE,
  subject: { ...TOKENS_RESPONSE.subject, displayName: 'Владелец Артём', role: 'OWNER' },
}

/** Команда заведения: владелец и один кассир. */
const TEAM = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Владелец Артём',
    role: 'OWNER',
    isActive: true,
    isLocked: false,
    lastSeenAt: '2026-09-14T08:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    devices: [{ deviceCode: 'demo-kata-owner', label: 'Телефон владельца', isActive: true }],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Сомчай',
    role: 'CASHIER',
    isActive: true,
    isLocked: false,
    lastSeenAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    devices: [{ deviceCode: 'pos-7k2p9q', label: 'Касса у бара', isActive: true }],
  },
]

describe('Команда', () => {
  it('ВЛАДЕЛЕЦ ВИДИТ «КОМАНДУ» В МЕНЮ', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('link', { name: t('nav.team') })).toBeInTheDocument()
  })

  it('менеджеру пункта «Команда» нет — управлять ею может только владелец', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('link', { name: t('nav.guests') })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('nav.team') })).not.toBeInTheDocument()
  })

  it('ПОСЛЕ ДОБАВЛЕНИЯ ПОКАЗЫВАЕТ КОД УСТРОЙСТВА И PIN — И УБИРАЕТ PIN ПОСЛЕ «ГОТОВО»', async () => {
    // PIN знают двое: тот, кто задал, и тот, кому передали. Сервер хранит
    // только хеш, и после карточки доступа PIN на экране появляться не должен.
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/staff': (init) =>
        init?.method === 'POST'
          ? json(
              {
                staff: {
                  ...TEAM[1],
                  id: '33333333-3333-4333-8333-333333333333',
                  displayName: 'Нок',
                  devices: [{ deviceCode: 'pos-m3x8vd', label: 'Нок', isActive: true }],
                },
                deviceCode: 'pos-m3x8vd',
              },
              201,
            )
          : json(TEAM),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.team') }))
    fireEvent.click(await screen.findByRole('button', { name: t('team.add') }))

    fireEvent.change(screen.getByLabelText(t('team.form.name')), { target: { value: 'Нок' } })
    fireEvent.change(screen.getByLabelText(t('team.form.pin')), { target: { value: '5820' } })
    fireEvent.click(screen.getByRole('button', { name: t('team.form.submit') }))

    expect(await screen.findByText('pos-m3x8vd')).toBeInTheDocument()
    expect(screen.getByText('5820')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('team.access.done') }))

    await waitFor(() => {
      expect(screen.queryByText('5820')).not.toBeInTheDocument()
    })
  })

  it('ОТКЛЮЧЕНИЕ СНАЧАЛА ПЕРЕСПРАШИВАЕТ И БЕЗ ПОДТВЕРЖДЕНИЯ НИЧЕГО НЕ ОТПРАВЛЯЕТ', async () => {
    // Отключение выкидывает кассира из кассы посреди чека. Случайный тап здесь
    // стоит очереди у стойки — поэтому одного нажатия мало.
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/staff': (init) =>
        init?.method === 'PATCH' ? json({ ...TEAM[1], isActive: false }) : json(TEAM),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.team') }))
    expect(await screen.findByText('Сомчай')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('team.action.disable') }))

    expect(screen.getByText(t('team.action.disableConfirm'))).toBeInTheDocument()

    const patchCalls = (): unknown[] =>
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )

    expect(patchCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: t('team.action.disable') }))

    await waitFor(() => {
      expect(patchCalls()).toHaveLength(1)
    })

    const [, init] = patchCalls()[0] as [unknown, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false })
  })

  it('у строки владельца нет действий — сервер её всё равно не примет', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/staff': () => json(TEAM),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.team') }))

    expect(await screen.findByText(t('team.owner.noActions'))).toBeInTheDocument()
    // Одна кнопка «Отключить» — у кассира. У владельца её нет.
    expect(screen.getAllByRole('button', { name: t('team.action.disable') })).toHaveLength(1)
  })
})
