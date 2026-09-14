import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const PROGRAM_SETTINGS = {
  baseEarnRate: 5,
  baseRedeemRate: 20,
  cashierRules: { requireReceiptNumber: true, maxManualAmount: null, allowManualEntry: true },
}

describe('Настройки программы', () => {
  const openSettings = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    await screen.findByLabelText(t('settings.earn.label'))
  }

  it('менеджеру пункта «Настройки» нет — процент начисления это деньги владельца', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    expect(await screen.findByRole('link', { name: t('nav.guests') })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('nav.settings') })).not.toBeInTheDocument()
  })

  it('ПРИМЕР НА ЧЕКЕ ПЕРЕСЧИТЫВАЕТСЯ, ПОКА ВЛАДЕЛЕЦ МЕНЯЕТ ПРОЦЕНТ', async () => {
    // «5%» — это число. «Гость получит 50 ฿» — это деньги, и решение о деньгах
    // принимают, глядя на деньги.
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    // 5% от 1 000 ฿ и 20% оплаты баллами.
    expect(screen.getByText('50,00 ฿')).toBeInTheDocument()
    expect(screen.getByText('200,00 ฿')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('settings.earn.label')), { target: { value: '10' } })

    expect(await screen.findByText('100,00 ฿')).toBeInTheDocument()
  })

  it('ПОТОЛОК ЧЕКА УХОДИТ В САТАНГАХ, А НЕ В БАТАХ', async () => {
    // Владелец пишет «3000» и думает батами. Касса считает сатангами. Перепутать
    // — значит поставить потолок в 30 ฿, и касса откажет на первом же обеде.
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program': (init) =>
        init?.method === 'PUT'
          ? json({
              ...PROGRAM_SETTINGS,
              cashierRules: { ...PROGRAM_SETTINGS.cashierRules, maxManualAmount: 300_000 },
            })
          : json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    fireEvent.change(screen.getByLabelText(t('settings.cap.label')), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: t('settings.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      const body = JSON.parse((put?.[1] as RequestInit).body as string) as {
        cashierRules: { maxManualAmount: number | null }
      }
      expect(body.cashierRules.maxManualAmount).toBe(300_000)
    })

    expect(await screen.findByText(t('settings.saved'))).toBeInTheDocument()
  })

  it('невозможный процент не отправляется и объясняется рядом с полем', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    fireEvent.change(screen.getByLabelText(t('settings.earn.label')), { target: { value: '80' } })

    expect(screen.getByText(t('settings.invalid.earn'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.save') })).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(false)
  })

  it('без изменений сохранять нечего — кнопка неактивна', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    expect(screen.getByRole('button', { name: t('settings.save') })).toBeDisabled()
  })
})

const GUEST_ID = '12121212-1212-4121-8121-121212121212'
const GUEST_MEMBERSHIP_ID = '13131313-1313-4131-8131-131313131313'

const GUEST_ROWS = {
  items: [
    {
      membershipId: GUEST_MEMBERSHIP_ID,
      guestId: GUEST_ID,
      displayName: 'Анна Ковалёва',
      phone: '+66 •• •• 4821',
      mode: 'TOURIST',
      pointsBalance: 30_175,
      visitsTotal: 4,
      spentTotal: 603_500,
      lastVisitAt: '2026-09-05T13:10:00.000Z',
      isControlGroup: false,
    },
  ],
  total: 1,
}

/** Карточка: отменённый чек с кассиром и видом продажи, подарок, погашенный в другом чеке. */
const GUEST_CARD = {
  guestId: GUEST_ID,
  membershipId: GUEST_MEMBERSHIP_ID,
  displayName: 'Анна Ковалёва',
  phone: '+66 •• •• 4821',
  mode: 'TOURIST',
  source: 'ORGANIC',
  isControlGroup: false,
  firstVisitAt: '2026-08-20T12:00:00.000Z',
  lastVisitAt: '2026-09-05T13:10:00.000Z',
  pointsBalance: 30_175,
  visitsTotal: 4,
  spentTotal: 603_500,
  averageCheck: 150_875,
  timeline: [
    {
      kind: 'GIFT',
      grantId: '14141414-1414-4141-8141-141414141414',
      at: '2026-09-05T13:12:00.000Z',
      title: 'Десерт в подарок',
      codeTail: 'K7QX',
      state: 'REDEEMED',
      expiresAt: '2026-10-05T13:12:00.000Z',
      redeemedAt: '2026-09-06T11:00:00.000Z',
      redeemedReceiptId: '1042',
    },
    {
      kind: 'OPERATION',
      id: '15151515-1515-4151-8151-151515151515',
      at: '2026-09-05T13:10:00.000Z',
      type: 'EARN',
      source: 'STAFF_MANUAL',
      amount: 4_500,
      basisAmount: 90_000,
      receiptId: '1041',
      saleKind: 'Абонемент',
      staffName: 'Кассир Лек',
      reversed: true,
    },
  ],
  timelineLimit: 50,
  timelineTruncated: false,
}

const requested = (fetchMock: ReturnType<typeof vi.fn>, needle: string): boolean =>
  fetchMock.mock.calls.some(([input]) => requestOf(input as RequestInfo | URL).includes(needle))

describe('Гости: поиск и карточка', () => {
  const openGuests = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.guests') }))
    await screen.findByRole('searchbox', { name: t('guests.search.label') })
  }

  it('ГОСТЬ ГОВОРИТ «…4821» — ЦИФРЫ УХОДЯТ В ПОИСК И НАХОДЯТ ЕГО', async () => {
    const fetchMock = stubApi({ '/v1/admin/guests': () => json(GUEST_ROWS) })
    render(<App />)

    await openGuests()

    fireEvent.change(screen.getByRole('searchbox', { name: t('guests.search.label') }), {
      target: { value: '4821' },
    })

    await waitFor(() => {
      expect(requested(fetchMock, 'q=4821')).toBe(true)
    })
    expect(await screen.findByRole('button', { name: 'Анна Ковалёва' })).toBeInTheDocument()
  })

  it('никого не нашли — так и сказано, с подсказкой, как искать', async () => {
    stubApi({ '/v1/admin/guests': () => json({ items: [], total: 0 }) })
    render(<App />)

    await openGuests()

    fireEvent.change(screen.getByRole('searchbox', { name: t('guests.search.label') }), {
      target: { value: 'Зоя' },
    })

    expect(await screen.findByText(t('guests.search.nothing'))).toBeInTheDocument()
    // «Гостей пока нет» здесь было бы враньём: гости есть, не нашёлся один.
    expect(screen.queryByText(t('guests.empty.title'))).not.toBeInTheDocument()
  })

  it('КАРТОЧКА: ЧЕК, КАССИР, ОТМЕНА И ПУТЬ ПОДАРКА — ОДНОЙ ЛЕНТОЙ', async () => {
    stubApi({
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await openGuests()

    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))

    const card = await screen.findByRole('dialog', { name: 'Анна Ковалёва' })

    // Средний чек 1 508,75 ฿ — разряды разделены неразрывным пробелом.
    expect(within(card).getByText(/1\s508,75 ฿/)).toBeInTheDocument()
    expect(
      within(card).getByText('чек 1041 · 900,00 ฿ · Абонемент · Кассир Лек'),
    ).toBeInTheDocument()
    expect(within(card).getByText(t('guestCard.op.reversed'))).toBeInTheDocument()
    expect(within(card).getByText(/погашен .*чек 1042/)).toBeInTheDocument()
    expect(within(card).getByText(`${t('guestCard.gift.code')} …K7QX`)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('поиск в шапке ведёт к гостям с уже набранным запросом', async () => {
    const fetchMock = stubApi({ '/v1/admin/guests': () => json(GUEST_ROWS) })
    render(<App />)

    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByRole('searchbox', { name: t('search.label') }), {
      target: { value: '4821' },
    })
    fireEvent.submit(screen.getByRole('search', { name: t('search.label') }))

    expect(
      await screen.findByRole('heading', { level: 1, name: t('guests.title') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: t('guests.search.label') })).toHaveValue('4821')
    await waitFor(() => {
      expect(requested(fetchMock, 'q=4821')).toBe(true)
    })
  })
})

const STUDIO_TENANT = '21212121-2121-4212-8212-212121212121'
const PARTNERSHIP_ID = '31313131-3131-4313-8313-313131313131'
const SUBSCRIPTION_KIND = '41414141-4141-4414-8414-414141414141'

const INCOMING_INVITE = {
  id: PARTNERSHIP_ID,
  status: 'PROPOSED',
  direction: 'INCOMING',
  partner: { tenantId: STUDIO_TENANT, brandName: 'Dance Studio Kata', vertical: 'OTHER' },
  proposedAt: '2026-09-14T09:00:00.000Z',
  acceptedAt: null,
  endsAt: null,
  activeTerms: { weGive: 0, theyGive: 0 },
}

/** Своё предложенное условие: ресторан дарит ролл гостям студии за абонемент. */
const ROLL_TERM = {
  id: '51515151-5151-4515-8515-515151515151',
  direction: 'WE_GIVE',
  status: 'PROPOSED',
  trigger: { type: 'ON_SALE_KIND', saleKindId: SUBSCRIPTION_KIND, minAmount: 500_000 },
  reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
  validityDays: 14,
  limits: { totalGrants: 200, perGuest: 1, dailyCap: 10 },
  saleKindName: 'Абонемент на месяц',
  proposedByUs: true,
  acceptedAt: null,
  pausedByUs: false,
  grantsIssued: 0,
  grantsRedeemed: 0,
  actions: { accept: false, reject: true, pause: false, resume: false },
}

const NEGOTIATING_PARTNERSHIP = {
  ...INCOMING_INVITE,
  status: 'NEGOTIATING',
  acceptedAt: '2026-09-14T10:00:00.000Z',
  endReason: null,
  terms: [ROLL_TERM],
  messages: [
    {
      id: '61616161-6161-4616-8616-616161616161',
      kind: 'INVITE',
      fromUs: false,
      text: 'Мы студия танцев через дорогу, у нас двести учеников в месяц.',
      sourceLang: 'ru',
      createdAt: '2026-09-14T09:00:00.000Z',
    },
  ],
  actions: { accept: false, decline: false, end: true, block: true, message: true },
}

/**
 * Сервер партнёрств. Порядок ключей важен: заглушка ищет по началу пути,
 * поэтому длинные пути идут раньше короткого `/v1/admin/partnerships`.
 */
const partnersApi = (
  extra: Partial<Record<string, (init?: RequestInit) => Response>> = {},
): Partial<Record<string, (init?: RequestInit) => Response>> => ({
  [`/v1/admin/partnerships/${PARTNERSHIP_ID}/sale-kinds`]: () =>
    json({ ours: [], theirs: [{ id: SUBSCRIPTION_KIND, name: 'Абонемент на месяц' }] }),
  [`/v1/admin/partnerships/${PARTNERSHIP_ID}/terms`]: () => json(NEGOTIATING_PARTNERSHIP),
  [`/v1/admin/partnerships/${PARTNERSHIP_ID}`]: () => json(NEGOTIATING_PARTNERSHIP),
  '/v1/admin/partnerships/invites': () =>
    json({ partnershipId: PARTNERSHIP_ID, quota: { freeLimit: 3, freeUsed: 1, freeLeft: 2 } }, 201),
  '/v1/admin/partnerships/quota': () => json({ freeLimit: 3, freeUsed: 0, freeLeft: 3 }),
  '/v1/admin/partners/catalog': () =>
    json({
      items: [
        {
          tenantId: STUDIO_TENANT,
          brandName: 'Dance Studio Kata',
          vertical: 'OTHER',
          guestsApprox: 200,
          partnership: null,
        },
      ],
    }),
  '/v1/admin/partnerships': () => json({ items: [INCOMING_INVITE] }),
  ...extra,
})

const postedTo = (
  fetchMock: ReturnType<typeof vi.fn>,
  suffix: string,
): Record<string, unknown> | undefined => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) =>
      requestOf(input as RequestInfo | URL).endsWith(suffix) &&
      (init as RequestInit | undefined)?.method === 'POST',
  )

  return call === undefined
    ? undefined
    : (JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>)
}

describe('Партнёры', () => {
  const openPartners = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('link', { name: t('nav.partners') }))
    await screen.findByRole('heading', { level: 1, name: t('partners.title') })
  }

  const openPartnership = async (): Promise<void> => {
    await openPartners()
    fireEvent.click(await screen.findByRole('link', { name: /Dance Studio Kata/ }))
    await screen.findByRole('heading', { level: 1, name: 'Dance Studio Kata' })
  }

  const inviteFromCatalog = async (): Promise<void> => {
    await openPartners()
    fireEvent.click(screen.getByRole('tab', { name: t('partners.tab.catalog') }))
    fireEvent.click(await screen.findByRole('button', { name: t('partners.catalog.invite') }))
  }

  it('ВХОДЯЩЕЕ ПРИГЛАШЕНИЕ — С ПОМЕТКОЙ «ЖДЁТ ВАШЕГО ОТВЕТА»', async () => {
    stubApi(partnersApi())
    render(<App />)

    await fillAndSubmitLogin()
    await openPartners()

    const row = await screen.findByRole('link', { name: /Dance Studio Kata/ })
    expect(within(row).getByText(t('partners.waitingUs'))).toBeInTheDocument()
  })

  it('ВЛАДЕЛЕЦ ПРИГЛАШАЕТ ИЗ КАТАЛОГА: ТЕКСТ УЖЕ НАПИСАН, ПОСЛЕ ОТПРАВКИ ОТКРЫВАЕТСЯ ПАРТНЁРСТВО', async () => {
    const fetchMock = stubApi(partnersApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) }))
    render(<App />)

    await fillAndSubmitLogin()
    await inviteFromCatalog()

    // Первое сообщение незнакомцу — самый высокий барьер; шаблон его снимает.
    const text = screen.getByLabelText(t('partners.invite.label'))
    expect((text as HTMLTextAreaElement).value.length).toBeGreaterThanOrEqual(40)

    fireEvent.click(screen.getByRole('button', { name: t('partners.invite.send') }))

    await waitFor(() => {
      expect(postedTo(fetchMock, '/partnerships/invites')).toMatchObject({
        partnerTenantId: STUDIO_TENANT,
      })
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dance Studio Kata' }),
    ).toBeInTheDocument()
  })

  it('кончились бесплатные приглашения — экран показывает объяснение сервера', async () => {
    stubApi(
      partnersApi({
        '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
        '/v1/admin/partnerships/invites': () =>
          json(
            {
              error: {
                code: 'INVITE_QUOTA_EXCEEDED',
                message: 'Бесплатные приглашения на сегодня закончились',
              },
            },
            402,
          ),
      }),
    )
    render(<App />)

    await fillAndSubmitLogin()
    await inviteFromCatalog()

    fireEvent.click(screen.getByRole('button', { name: t('partners.invite.send') }))

    expect(
      await screen.findByText('Бесплатные приглашения на сегодня закончились'),
    ).toBeInTheDocument()
  })

  it('УСЛОВИЕ ЧИТАЕТСЯ ФРАЗОЙ, А НЕ ПОЛЯМИ', async () => {
    stubApi(partnersApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) }))
    render(<App />)

    await fillAndSubmitLogin()
    await openPartnership()

    expect(
      screen.getByText(
        /^За «Абонемент на месяц» от 5\s000 ฿ у Dance Studio Kata — мы дарим «Ролл Филадельфия» при чеке от 800 ฿\.$/,
      ),
    ).toBeInTheDocument()
    // Своё предложенное условие отзывают, а не отклоняют.
    expect(screen.getByRole('button', { name: t('partner.term.withdraw') })).toBeInTheDocument()
  })

  it('КОНСТРУКТОР: ВИД ПРОДАЖ — ИЗ СПИСКА ПАРТНЁРА, БАТЫ УХОДЯТ САТАНГАМИ', async () => {
    const fetchMock = stubApi(partnersApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) }))
    render(<App />)

    await fillAndSubmitLogin()
    await openPartnership()

    fireEvent.click(screen.getByRole('button', { name: t('partner.terms.propose') }))
    fireEvent.change(screen.getByLabelText(t('termForm.trigger')), {
      target: { value: 'ON_SALE_KIND' },
    })
    await screen.findByRole('option', { name: 'Абонемент на месяц' })

    fireEvent.change(screen.getByLabelText(t('termForm.minAmount')), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText(t('termForm.itemName')), {
      target: { value: 'Ролл Филадельфия' },
    })
    fireEvent.change(screen.getByLabelText(t('termForm.minCheck')), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('button', { name: t('termForm.submit') }))

    await waitFor(() => {
      expect(postedTo(fetchMock, `/partnerships/${PARTNERSHIP_ID}/terms`)).toEqual({
        direction: 'WE_GIVE',
        trigger: { type: 'ON_SALE_KIND', saleKindId: SUBSCRIPTION_KIND, minAmount: 500_000 },
        reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
        validityDays: 14,
        limits: { totalGrants: null, perGuest: 1, dailyCap: 10 },
      })
    })
  })

  it('менеджер видит партнёрство, но кнопок договориться у него нет', async () => {
    stubApi(partnersApi())
    render(<App />)

    await fillAndSubmitLogin()
    await openPartnership()

    expect(screen.queryByRole('button', { name: t('partner.action.end') })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('partner.terms.propose') }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('partner.term.withdraw') }),
    ).not.toBeInTheDocument()
  })
})

describe('Подарок из карточки гостя', () => {
  const openCard = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.guests') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    return screen.findByRole('dialog', { name: 'Анна Ковалёва' })
  }

  const giftApi = (): Partial<Record<string, (init?: RequestInit) => Response>> => ({
    [`/v1/admin/guests/${GUEST_ID}/gifts`]: () =>
      json(
        {
          grantId: '71717171-7171-4717-8717-717171717171',
          title: 'Десерт',
          codeTail: 'Q7XR',
          expiresAt: '2026-09-29T12:00:00.000Z',
          replayed: false,
        },
        201,
      ),
    [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
    '/v1/admin/guests': () => json(GUEST_ROWS),
  })

  it('ПОДАРИТЬ: ЧТО, ЗА ЧТО, СРОК — И КЛЮЧ ПОВТОРА В ЗАГОЛОВКЕ', async () => {
    const fetchMock = stubApi(giftApi())
    render(<App />)

    const card = await openCard()

    fireEvent.click(within(card).getByRole('button', { name: t('gift.open') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.preset.dessert') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.reason.LONG_WAIT') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.submit') }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/gifts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(call).toBeDefined()

      const init = call?.[1] as RequestInit
      expect(JSON.parse(init.body as string)).toEqual({
        title: 'Десерт',
        reason: 'LONG_WAIT',
        validityDays: 14,
      })
      // Без ключа повтор нажатия после обрыва связи подарил бы второй десерт.
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^.{8,}$/)
    })

    expect(await within(card).findByText(/код …Q7XR/)).toBeInTheDocument()
  })

  it('«Другое» без комментария не отправить — причина подарка должна быть понятна', async () => {
    stubApi(giftApi())
    render(<App />)

    const card = await openCard()

    fireEvent.click(within(card).getByRole('button', { name: t('gift.open') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.preset.dessert') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.reason.OTHER') }))

    expect(within(card).getByRole('button', { name: t('gift.submit') })).toBeDisabled()

    fireEvent.change(within(card).getByLabelText(t('gift.comment')), {
      target: { value: 'Сосед по столику пролил кофе' },
    })

    expect(within(card).getByRole('button', { name: t('gift.submit') })).toBeEnabled()
  })
})

describe('Погашение промокода на кассе', () => {
  const openRedeem = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.pos') }))
    fireEvent.click(await screen.findByRole('button', { name: t('pos.redeem.open') }))
  }

  it('КОД С ЭКРАНА ГОСТЯ → «ОТДАЙТЕ ГОСТЮ» — И ЧЕК УХОДИТ КЛЮЧОМ ПОВТОРА', async () => {
    const fetchMock = stubApi({
      '/v1/pos/grants/redeem': () =>
        json({
          grantId: '81818181-8181-4818-8818-818181818181',
          code: 'K7QX2M9PQ7XR',
          offerId: '91919191-9191-4919-8919-919191919191',
          title: 'Ролл Филадельфия в подарок',
          redeemedAt: '2026-09-15T10:00:00.000Z',
          replayed: false,
        }),
    })
    render(<App />)

    await openRedeem()

    // Гость диктует как видит: с пробелами и строчными.
    fireEvent.change(screen.getByLabelText(t('pos.redeem.code')), {
      target: { value: 'k7qx 2m9p q7xr' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.redeem.submit') }))

    expect(await screen.findByText('Ролл Филадельфия в подарок')).toBeInTheDocument()

    const body = postedTo(fetchMock, '/pos/grants/redeem')
    expect(body).toMatchObject({ code: 'K7QX2M9PQ7XR' })
    // Номера чека кассир не ввёл — ключ повтора всё равно ушёл.
    expect(String(body?.['receiptId'])).toMatch(/^pos-/)
  })

  it('погашенный код — текст сервера и подсказка, что сказать гостю', async () => {
    stubApi({
      '/v1/pos/grants/redeem': () =>
        json({ error: { code: 'GRANT_ALREADY_USED', message: 'Код уже погашен' } }, 400),
    })
    render(<App />)

    await openRedeem()

    fireEvent.change(screen.getByLabelText(t('pos.redeem.code')), {
      target: { value: 'K7QX2M9PQ7XR' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.redeem.submit') }))

    expect(await screen.findByText('Код уже погашен')).toBeInTheDocument()
    expect(screen.getByText(t('pos.redeem.hint.GRANT_ALREADY_USED'))).toBeInTheDocument()
  })
})

describe('Прогноз сгорания подарков', () => {
  it('ПОДАРКИ, КОТОРЫЕ СКОРО СГОРЯТ, — ПЕРВЫМ СОВЕТОМ, С ЧИСЛОМ И СРОКОМ', async () => {
    stubApi({
      '/v1/admin/dashboard': () =>
        json({
          ...DASHBOARD,
          advice: [
            { kind: 'EXPIRING_GIFTS', gifts: 12, withinDays: 7 },
            { kind: 'SLEEPING_GUESTS', guests: 26 },
          ],
        }),
    })
    render(<App />)

    await fillAndSubmitLogin()

    // 12 по-русски — форма «many»: «12 подарков сгорят в ближайшие 7 дней».
    const text = `12 ${t('overview.advice.expiring.many').replace('{days}', '7')}`
    const card = await screen.findByText(text)

    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('advice-card'))
    expect(cards[0]).toContainElement(card)
    expect(
      screen.getByRole('link', { name: t('overview.advice.expiring.action') }),
    ).toBeInTheDocument()
  })
})

const STUCK_LIST = {
  items: [
    {
      receiptId: 'pos-lx2k9-a1b2c3',
      amount: 125_000,
      receiptNumber: '1042',
      guest: '+66 •• •• 4821',
      staffName: 'Кассир Лек',
      terminal: 'a1b2',
      attempts: 20,
      stuck: true,
      lastError: 'Номер чека обязателен',
      queuedAt: '2026-09-15T09:00:00.000Z',
      reportedAt: '2026-09-15T11:30:00.000Z',
    },
  ],
}

describe('Застрявшие чеки', () => {
  it('ВЛАДЕЛЕЦ ВИДИТ НА ЭКРАНЕ КАССЫ ЧЕКИ, КОТОРЫЕ НЕ ДОШЛИ, — С ПРИЧИНОЙ И ПЛАНШЕТОМ', async () => {
    stubApi({ '/v1/admin/stuck-receipts': () => json(STUCK_LIST) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.pos') }))

    const panel = await screen.findByRole('region', { name: t('stuck.title') })
    expect(within(panel).getByText('Номер чека обязателен')).toBeInTheDocument()
    expect(within(panel).getByText('+66 •• •• 4821')).toBeInTheDocument()
    expect(within(panel).getByText(t('stuck.terminal').replace('{id}', 'a1b2'))).toBeInTheDocument()
  })

  it('кассиру список не показывают и даже не запрашивают', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/admin/stuck-receipts': () => json(STUCK_LIST),
    })
    render(<App />)

    await fillAndSubmitLogin()
    await screen.findByLabelText(t('pos.phone.label'))

    expect(screen.queryByText(t('stuck.title'))).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestOf(input as RequestInfo | URL).includes('/admin/stuck-receipts'),
      ),
    ).toBe(false)
  })

  it('ПЛАНШЕТ СООБЩАЕТ ВЛАДЕЛЬЦУ, ЧТО ЧЕК ЛЁГ В ОЧЕРЕДЬ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/commit': () => OFFLINE,
      '/v1/pos/queue': () => json({ tracked: 1 }),
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

    await screen.findByText(t('pos.queued.title'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/pos/queue') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(call).toBeDefined()

      const body = JSON.parse((call?.[1] as RequestInit).body as string) as {
        terminalId: string
        items: Array<Record<string, unknown>>
      }
      expect(body.terminalId).toMatch(/^[A-Za-z0-9-]{8,64}$/)
      expect(body.items).toEqual([
        expect.objectContaining({ amount: 125_000, receiptNumber: 'B-1' }),
      ])
    })
  })

  it('недошедшие чеки — первым советом на «Обзоре», со ссылкой на кассу', async () => {
    stubApi({
      '/v1/admin/dashboard': () =>
        json({
          ...DASHBOARD,
          advice: [
            { kind: 'STUCK_RECEIPTS', receipts: 3 },
            { kind: 'EXPIRING_GIFTS', gifts: 12, withinDays: 7 },
          ],
        }),
    })
    render(<App />)

    await fillAndSubmitLogin()

    // 3 по-русски — форма «few»: «3 чека не дошли».
    expect(await screen.findByText(`3 ${t('overview.advice.stuck.few')}`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('overview.advice.stuck.action') })).toHaveAttribute(
      'href',
      '/pos',
    )
  })
})

/** Застрявший чек на планшете этого заведения: сервер потребовал номер чека. */
const STUCK_SALE = {
  receiptId: 'pos-stuck-1',
  tenantId: TOKENS_RESPONSE.subject.tenantId,
  target: { kind: 'MEMBERSHIP', membershipId: POS_GUEST.membershipId },
  amount: 125_000,
  queuedAt: Date.UTC(2026, 8, 15, 9, 0),
  attempts: 20,
  lastError: 'Номер чека обязателен',
}

/** Без номера чека предрасчёт отказывает — чек так и остаётся застрявшим. */
const previewNeedsReceipt = (init?: RequestInit): Response => {
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
    receiptNumber?: string
  }

  return body.receiptNumber === undefined
    ? json({ error: { code: 'RECEIPT_REQUIRED', message: 'Номер чека обязателен' } }, 400)
    : json(POS_PREVIEW)
}

const storedQueue = (): unknown[] =>
  JSON.parse(window.localStorage.getItem('positive.pos.queue') ?? '[]') as unknown[]

describe('Застрявший чек на планшете', () => {
  const seedAndOpen = async (): Promise<{
    fetchMock: ReturnType<typeof vi.fn>
    panel: HTMLElement
  }> => {
    window.localStorage.setItem('positive.pos.queue', JSON.stringify([STUCK_SALE]))
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/preview': previewNeedsReceipt,
    })
    render(<App />)

    await fillAndSubmitLogin()
    const panel = await screen.findByRole('region', { name: t('pos.stuckList.title') })

    return { fetchMock, panel }
  }

  it('ВПИСАТЬ НОМЕР И ПОВТОРИТЬ — ЧЕК УХОДИТ ТЕМ ЖЕ КЛЮЧОМ, ОЧЕРЕДЬ ПУСТЕЕТ', async () => {
    const { fetchMock, panel } = await seedAndOpen()

    expect(within(panel).getByText('Номер чека обязателен')).toBeInTheDocument()

    fireEvent.change(within(panel).getByLabelText(t('pos.stuckList.receipt')), {
      target: { value: 'A-42' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: t('pos.stuckList.retry') }))

    // Тот же ключ идемпотентности: если чек когда-то всё же дошёл, второго не будет.
    await waitFor(() => {
      expect(postedTo(fetchMock, '/pos/transactions/commit')).toMatchObject({
        receiptId: 'pos-stuck-1',
      })
    })
    await waitFor(() => {
      expect(storedQueue()).toEqual([])
    })
    expect(screen.queryByRole('region', { name: t('pos.stuckList.title') })).not.toBeInTheDocument()
  })

  it('УБРАТЬ — ТОЛЬКО ПОСЛЕ ПОДТВЕРЖДЕНИЯ, И ЧЕК ПРОПАДАЕТ С ПЛАНШЕТА', async () => {
    const { panel } = await seedAndOpen()

    fireEvent.click(within(panel).getByRole('button', { name: t('pos.stuckList.discard') }))

    // Одним нажатием чек не пропадает: гость по нему может остаться без баллов.
    expect(within(panel).getByText(t('pos.stuckList.confirm'))).toBeInTheDocument()
    expect(storedQueue()).toHaveLength(1)

    fireEvent.click(within(panel).getByRole('button', { name: t('pos.stuckList.discardYes') }))

    await waitFor(() => {
      expect(storedQueue()).toEqual([])
    })
  })
})

describe('Советы про партнёров', () => {
  it('ПАРТНЁРЫ ЖДУТ ОТВЕТА И ПАРТНЁР ПРИСЛАЛ ГОСТЕЙ — СОВЕТЫ ВЕДУТ В ПАРТНЁРСТВА', async () => {
    stubApi({
      '/v1/admin/dashboard': () =>
        json({
          ...DASHBOARD,
          advice: [
            { kind: 'PARTNERS_WAITING', invites: 1, terms: 2 },
            {
              kind: 'PARTNER_RECIPROCATE',
              partnershipId: PARTNERSHIP_ID,
              partnerName: 'Dance Studio Kata',
              guests: 12,
            },
          ],
        }),
    })
    render(<App />)

    await fillAndSubmitLogin()

    expect(
      await screen.findByText(
        t('overview.advice.partnersWaiting.text').replace('{invites}', '1').replace('{terms}', '2'),
      ),
    ).toBeInTheDocument()
    // 12 по-русски — форма «many»: «12 гостей пришли».
    expect(
      screen.getByText(
        t('overview.advice.reciprocate.many')
          .replace('{partner}', 'Dance Studio Kata')
          .replace('{n}', '12'),
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: t('overview.advice.partnersWaiting.action') }),
    ).toHaveAttribute('href', '/partners')
    expect(
      screen.getByRole('link', { name: t('overview.advice.reciprocate.action') }),
    ).toHaveAttribute('href', `/partners/${PARTNERSHIP_ID}`)
  })
})

const OFFERS = {
  items: [
    {
      id: '52525252-5252-4525-8525-525252525252',
      status: 'LIVE',
      title: 'Ролл Филадельфия в подарок',
      howTo: ['Покажите код на кассе', 'К заказу от 800 ฿'],
      partner: { partnershipId: PARTNERSHIP_ID, name: 'Dance Studio Kata' },
      issued: 12,
      redeemed: 7,
      returned: 3,
      createdAt: '2026-09-14T10:00:00.000Z',
    },
    {
      id: '53535353-5353-4535-8535-535353535353',
      status: 'ENDED',
      title: 'Вернём 200 ฿',
      howTo: [],
      partner: null,
      issued: 40,
      redeemed: 31,
      returned: 12,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
  ],
}

describe('Акции', () => {
  const openOffers = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.offers') }))
    await screen.findByRole('heading', { level: 1, name: t('offers.title') })
  }

  it('ПАРТНЁРСКАЯ АКЦИЯ — С ПОМЕТКОЙ, КОТОРАЯ ВЕДЁТ В ПАРТНЁРСТВО, И С УСЛОВИЕМ СЛОВАМИ', async () => {
    stubApi({ '/v1/admin/offers': () => json(OFFERS) })
    render(<App />)

    await openOffers()

    const mark = await screen.findByRole('link', {
      name: t('offers.partner').replace('{name}', 'Dance Studio Kata'),
    })
    expect(mark).toHaveAttribute('href', `/partners/${PARTNERSHIP_ID}`)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Ролл Филадельфия в подарок' }),
    ).toBeInTheDocument()
    expect(screen.getByText('К заказу от 800 ฿')).toBeInTheDocument()
    expect(screen.getByText(t('offers.partnerHint'))).toBeInTheDocument()
  })

  it('фильтр «Завершены» уходит на сервер', async () => {
    const fetchMock = stubApi({ '/v1/admin/offers': () => json(OFFERS) })
    render(<App />)

    await openOffers()
    fireEvent.click(screen.getByRole('button', { name: t('offers.filter.ENDED') }))

    await waitFor(() => {
      expect(requested(fetchMock, 'filter=ENDED')).toBe(true)
    })
  })

  it('акций нет — честно сказано, откуда они берутся, и есть дорога в партнёры', async () => {
    stubApi({ '/v1/admin/offers': () => json({ items: [] }) })
    render(<App />)

    await openOffers()

    expect(await screen.findByText(t('offers.empty.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('offers.empty.action') })).toHaveAttribute(
      'href',
      '/partners',
    )
  })
})
