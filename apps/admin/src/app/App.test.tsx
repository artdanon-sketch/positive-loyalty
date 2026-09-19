import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fill } from '../shared/format/fill'
import { formatBaht, formatDate } from '../shared/format/format'
import { t } from '../shared/i18n'
import { GUEST_URL } from '../shared/config/env'
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
  tier: null,
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
  appliedOffers: [],
  skippedOffers: [],
}

const POS_COMMIT = {
  transactionId: '88888888-8888-4888-8888-888888888888',
  redeemed: 0,
  earned: 6_250,
  newBalance: 36_425,
  replayed: false,
  grantsIssued: [],
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
/** «Сегодня»: настройка пройдена — карточек нет, остальные тесты их не видят. */
const TODAY = {
  date: '2026-09-16',
  revenue: 386_500,
  purchases: 9,
  avgCheck: 42_944,
  buyers: 8,
  newGuests: 3,
  totalGuests: 412,
  pointsEarned: 19_325,
  pointsRedeemed: 4_000,
  voided: 1,
  setup: [
    { step: 'PROGRAM', done: true },
    { step: 'CASHIER', done: true },
    { step: 'OFFER', done: true },
    { step: 'CHANNEL', done: true },
  ],
}

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
    if (path.startsWith('/v1/admin/today')) {
      return Promise.resolve(json(TODAY))
    }
    if (path.startsWith('/v1/admin/dashboard')) {
      return Promise.resolve(json(DASHBOARD))
    }
    if (path.startsWith('/v1/admin/ledger')) {
      return Promise.resolve(json(EMPTY_LEDGER))
    }
    if (path.startsWith('/v1/admin/certificates')) {
      return Promise.resolve(json([]))
    }
    if (path.startsWith('/v1/admin/channels')) {
      return Promise.resolve(json([]))
    }
    if (path.startsWith('/v1/admin/reports/customers')) {
      return Promise.resolve(
        json({
          period: '30d',
          total: 0,
          buyers: 0,
          buyersPct: null,
          newGuests: 0,
          firstPurchases: 0,
          tourists: 0,
          residents: 0,
          series: [],
        }),
      )
    }
    if (path.startsWith('/v1/admin/reports/channels')) {
      return Promise.resolve(
        json({ period: '30d', channels: [], unattributed: { guests: 0, buyers: 0, revenue: 0 } }),
      )
    }
    if (path.startsWith('/v1/admin/tags')) {
      return Promise.resolve(json([]))
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
  // По умолчанию открыт вход владельца по почте; тесты входят как сотрудник
  // на планшете — переключаемся на его вкладку.
  fireEvent.click(await screen.findByRole('tab', { name: t('login.tab.staff') }))
  fireEvent.change(screen.getByLabelText(t('login.device')), {
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

describe('Сегодня', () => {
  const HALF_SET_UP = {
    ...TODAY,
    setup: [
      { step: 'PROGRAM', done: true },
      { step: 'CASHIER', done: false },
      { step: 'OFFER', done: true },
      { step: 'CHANNEL', done: false },
    ],
  }

  it('ВЫРУЧКА ДНЯ, ПОКУПАТЕЛИ И БАЛЛЫ — НАД ПЛИТКАМИ ПЕРИОДА', async () => {
    stubApi()
    render(<App />)

    await fillAndSubmitLogin()

    const today = await screen.findByRole('region', { name: t('today.title') })
    expect(within(today).getByText('3 865,00 ฿')).toBeInTheDocument()
    expect(within(today).getByText(t('today.purchases').replace('{n}', '9'))).toBeInTheDocument()
    expect(within(today).getByText(t('today.voided').replace('{n}', '1'))).toBeInTheDocument()
  })

  it('ВЛАДЕЛЕЦ ВИДИТ КАРТОЧКИ ТОЛЬКО НЕСДЕЛАННЫХ ШАГОВ — СО ССЫЛКОЙ В НУЖНЫЙ РАЗДЕЛ', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/today': () => json(HALF_SET_UP),
    })
    render(<App />)

    await fillAndSubmitLogin()

    const setup = await screen.findByRole('region', { name: t('today.setup.title') })
    expect(
      within(setup).getByRole('link', { name: new RegExp(t('today.setup.CASHIER')) }),
    ).toHaveAttribute('href', '/team')
    expect(
      within(setup).getByRole('link', { name: new RegExp(t('today.setup.CHANNEL')) }),
    ).toHaveAttribute('href', '/settings')
    expect(
      within(setup).queryByRole('link', { name: new RegExp(t('today.setup.PROGRAM')) }),
    ).not.toBeInTheDocument()
  })

  it('МЕНЕДЖЕРУ КАРТОЧЕК НАСТРОЙКИ НЕТ — ЭТО РАЗДЕЛЫ ВЛАДЕЛЬЦА', async () => {
    stubApi({ '/v1/admin/today': () => json(HALF_SET_UP) })
    render(<App />)

    await fillAndSubmitLogin()

    await screen.findByRole('region', { name: t('today.title') })
    expect(screen.queryByRole('region', { name: t('today.setup.title') })).not.toBeInTheDocument()
  })
})

describe('Безопасность', () => {
  const SUSPICIOUS = {
    period: '7d',
    maxChecksPerDay: 5,
    guests: [
      {
        membershipId: '95959595-9595-4959-8959-959595959595',
        guestId: '96969696-9696-4969-8969-969696969696',
        displayName: 'Гость Частый',
        phone: '+66812340000',
        day: '2026-09-15',
        receipts: 7,
      },
    ],
    cashiers: [
      {
        staffId: '97979797-9797-4979-8979-979797979797',
        displayName: 'Кассир Пим',
        signal: 'SELF_LINKED',
        day: '2026-09-15',
        receipts: 1,
        usual: null,
      },
      {
        staffId: '98989898-9898-4989-8989-989898989898',
        displayName: 'Кассир Лек',
        signal: 'BURST',
        day: '2026-09-16',
        receipts: 15,
        usual: 1.7,
      },
    ],
  }

  const HISTORY = {
    items: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        occurredAt: '2026-09-16T09:12:40.118Z',
        action: 'STAFF_PIN_RESET',
        actorType: 'OWNER',
        actor: { id: '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a', displayName: 'Владелец Артём' },
        entityType: 'Staff',
        entityId: '97979797-9797-4979-8979-979797979797',
        reason: null,
      },
    ],
    nextBefore: '2026-09-16T09:12:40.118Z',
  }

  const settingsApi = {
    '/v1/admin/settings/program/suspicious': (init?: RequestInit) =>
      init?.method === 'PUT' ? json(JSON.parse(init.body as string)) : json(SUSPICIOUS_SETTINGS),
    '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
    '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
    '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
    '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
    '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
    '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
  }

  const openReview = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    fireEvent.click(await screen.findByRole('link', { name: t('securitySettings.open') }))
  }

  it('РАЗБОР ИЗ НАСТРОЕК: КАССИР С ЧЕКОМ НА СВОЙ НОМЕР И ГОСТЬ ВЫШЕ ПОРОГА', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/security/suspicious': () => json(SUSPICIOUS),
      ...settingsApi,
    })
    render(<App />)

    await openReview()

    const cashiers = await screen.findByRole('table', { name: t('security.cashiers.title') })
    expect(within(cashiers).getByRole('row', { name: /Кассир Пим/ })).toHaveTextContent(
      t('security.signal.SELF_LINKED'),
    )
    expect(within(cashiers).getByRole('row', { name: /Кассир Лек/ })).toHaveTextContent('1.7')

    const guests = screen.getByRole('table', { name: t('security.guests.title') })
    expect(within(guests).getByRole('link', { name: 'Гость Частый' })).toHaveAttribute(
      'href',
      '/guests?guest=96969696-9696-4969-8969-969696969696',
    )
    expect(screen.getByText(t('security.guests.hint').replace('{n}', '5'))).toBeInTheDocument()
  })

  it('ИСТОРИЯ: КТО И ЧТО МЕНЯЛ; «РАНЬШЕ» ПРОСИТ СЛЕДУЮЩУЮ СТРАНИЦУ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/security/history': () => json(HISTORY),
      '/v1/admin/security/suspicious': () => json(SUSPICIOUS),
      ...settingsApi,
    })
    render(<App />)

    await openReview()
    fireEvent.click(await screen.findByRole('tab', { name: t('security.tab.history') }))

    const history = await screen.findByRole('table', { name: t('security.tab.history') })
    expect(within(history).getByRole('row', { name: /Владелец Артём/ })).toHaveTextContent(
      t('security.action.STAFF_PIN_RESET'),
    )

    fireEvent.click(screen.getByRole('button', { name: t('security.history.earlier') }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => requestOf(input as RequestInfo | URL))
      expect(
        urls.some((url) =>
          url.includes('/admin/security/history?before=2026-09-16T09%3A12%3A40.118Z'),
        ),
      ).toBe(true)
    })
  })

  it('ФИЛЬТРЫ ИСТОРИИ: ДЕНЬ И СОТРУДНИК УХОДЯТ В ЗАПРОС, «ПОКАЗАТЬ ВСЕ» СНИМАЕТ ИХ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/security/history': () => json(HISTORY),
      '/v1/admin/security/suspicious': () => json(SUSPICIOUS),
      '/v1/admin/staff': () => json(TEAM),
      ...settingsApi,
    })
    const asked = (part: string): boolean =>
      fetchMock.mock.calls.some(([input]) =>
        requestOf(input as RequestInfo | URL).includes(`/admin/security/history${part}`),
      )

    render(<App />)

    await openReview()
    fireEvent.click(await screen.findByRole('tab', { name: t('security.tab.history') }))
    await screen.findByRole('table', { name: t('security.tab.history') })

    // Сначала уходим со свежих — фильтр обязан вернуть листание в начало.
    fireEvent.click(screen.getByRole('button', { name: t('security.history.earlier') }))
    fireEvent.change(screen.getByLabelText(t('security.filter.day')), {
      target: { value: '2026-09-16' },
    })
    await waitFor(() => {
      expect(asked('?day=2026-09-16')).toBe(true)
    })

    fireEvent.change(await screen.findByLabelText(t('security.filter.staff')), {
      target: { value: '22222222-2222-4222-8222-222222222222' },
    })
    await waitFor(() => {
      expect(asked('?day=2026-09-16&actorId=22222222-2222-4222-8222-222222222222')).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: t('security.filter.reset') }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: t('security.filter.reset') })).toBeNull()
    })
    expect(screen.getByLabelText(t('security.filter.day'))).toHaveValue('')
    expect(screen.getByLabelText(t('security.filter.staff'))).toHaveValue('')
    expect(await screen.findByRole('table', { name: t('security.tab.history') })).toHaveTextContent(
      t('security.action.STAFF_PIN_RESET'),
    )
  })

  it('ПОРОГ ПОДОЗРИТЕЛЬНЫХ ЧЕКОВ СОХРАНЯЕТСЯ; ЕДИНИЦА — НЕЛЬЗЯ', async () => {
    const fetchMock = stubApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS), ...settingsApi })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    const section = await screen.findByRole('region', { name: t('securitySettings.title') })
    const input = await within(section).findByLabelText(t('securitySettings.maxChecks'))
    const save = within(section).getByRole('button', { name: t('securitySettings.save') })

    fireEvent.change(input, { target: { value: '1' } })
    expect(within(section).getByText(t('securitySettings.problem'))).toBeInTheDocument()
    expect(save).toBeDisabled()

    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.click(save)

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/program/suspicious') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({ maxChecksPerDay: 3 })
    })
  })
})

describe('Жалобы и предложения', () => {
  const MESSAGE = {
    id: '7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c',
    kind: 'COMPLAINT',
    text: 'Кондиционер не работает второй день',
    reply: null,
    repliedAt: null,
    createdAt: '2026-09-16T09:40:00.000Z',
    guest: {
      guestId: '96969696-9696-4969-8969-969696969696',
      membershipId: '95959595-9595-4959-8959-959595959595',
      displayName: 'Гость Аня',
      phone: '+66812340000',
    },
  }

  const openMessages = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reviews') }))
    fireEvent.click(await screen.findByRole('tab', { name: t('communication.tab.messages') }))
    return screen.findByRole('region', { name: t('messages.title') })
  }

  it('ЖАЛОБА ВИДНА С ЧИСЛОМ ЖДУЩИХ ОТВЕТА, ОТВЕТ УХОДИТ ОДНИМ ШАГОМ', async () => {
    const fetchMock = stubApi({
      '/v1/admin/messages': (init) =>
        init?.method === 'POST'
          ? json({ ...MESSAGE, reply: 'Починили', repliedAt: '2026-09-16T10:20:00.000Z' })
          : json({ total: 1, unanswered: 1, items: [MESSAGE] }),
    })
    render(<App />)

    const list = await openMessages()
    expect(
      await within(list).findByText(t('messages.unanswered').replace('{n}', '1')),
    ).toBeInTheDocument()

    const card = await within(list).findByRole('article', { name: /Гость Аня/ })
    expect(within(card).getByText(t('messages.kind.COMPLAINT'))).toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText(t('messages.replyLabel')), {
      target: { value: ' Починили ' },
    })
    fireEvent.click(within(card).getByRole('button', { name: t('messages.send') }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).includes('/admin/messages/') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ text: 'Починили' })
    })
  })

  it('ФИЛЬТР СУЖАЕТ ЗАПРОС И ВОЗВРАЩАЕТ НА ПЕРВУЮ СТРАНИЦУ', async () => {
    const fetchMock = stubApi({
      '/v1/admin/messages': () => json({ total: 25, unanswered: 0, items: [MESSAGE] }),
    })
    const asked = (tail: string): boolean =>
      fetchMock.mock.calls.some(([input]) =>
        requestOf(input as RequestInfo | URL).endsWith(`/admin/messages${tail}`),
      )

    render(<App />)

    const list = await openMessages()
    await within(list).findByRole('article', { name: /Гость Аня/ })

    // Ушли на вторую страницу — фильтр обязан вернуть на первую.
    fireEvent.click(within(list).getByRole('button', { name: t('messages.next') }))
    await waitFor(() => {
      expect(asked('?offset=20')).toBe(true)
    })

    fireEvent.click(within(list).getByRole('button', { name: t('messages.filter.unanswered') }))
    await waitFor(() => {
      expect(asked('?answered=no')).toBe(true)
    })
  })

  it('ОБРАЩЕНИЙ НЕТ — СПИСОК ГОВОРИТ ОБ ЭТОМ ПРЯМО', async () => {
    stubApi({ '/v1/admin/messages': () => json({ total: 0, unanswered: 0, items: [] }) })
    render(<App />)

    const list = await openMessages()
    expect(await within(list).findByText(t('messages.empty'))).toBeInTheDocument()
    expect(within(list).getByText(t('messages.allAnswered'))).toBeInTheDocument()
  })
})

describe('Новости', () => {
  const NEWS = {
    id: '9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b',
    title: 'Новое меню',
    body: 'С понедельника — суп дня.',
    isPublished: false,
    publishedAt: null,
    views: 0,
    createdAt: '2026-09-16T07:55:10.000Z',
  }

  const openNews = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reviews') }))
    fireEvent.click(await screen.findByRole('tab', { name: t('communication.tab.news') }))
    return screen.findByRole('region', { name: t('news.title') })
  }

  it('ВЛАДЕЛЕЦ ПИШЕТ НОВОСТЬ ЧЕРНОВИКОМ И ВЫПУСКАЕТ ЕЁ КНОПКОЙ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      [`/v1/admin/news/${NEWS.id}`]: () =>
        json({ ...NEWS, isPublished: true, publishedAt: '2026-09-16T08:00:00.000Z' }),
      '/v1/admin/news': (init) => (init?.method === 'POST' ? json(NEWS, 201) : json([NEWS])),
    })
    render(<App />)

    const list = await openNews()

    const form = await screen.findByRole('form', { name: t('news.form.title') })
    fireEvent.change(within(form).getByLabelText(t('news.field.title')), {
      target: { value: ' Новое меню ' },
    })
    fireEvent.change(within(form).getByLabelText(t('news.field.body')), {
      target: { value: 'С понедельника — суп дня.' },
    })
    fireEvent.click(within(form).getByRole('button', { name: t('news.create') }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/admin/news') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
        title: 'Новое меню',
        body: 'С понедельника — суп дня.',
        publish: false,
        imageUrl: null,
        notify: false,
      })
    })

    const item = await within(list).findByRole('article', { name: 'Новое меню' })
    expect(within(item).getByText(t('news.status.draft'))).toBeInTheDocument()
    fireEvent.click(within(item).getByRole('button', { name: t('news.publish') }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ isPublished: true })
    })
  })

  it('У ОПУБЛИКОВАННОЙ НОВОСТИ ВИДНО, СКОЛЬКО ГОСТЕЙ ЕЁ УВИДЕЛО', async () => {
    stubApi({
      '/v1/admin/news': () =>
        json([
          { ...NEWS, isPublished: true, publishedAt: '2026-09-16T08:00:00.000Z', views: 22 },
          { ...NEWS, id: '9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c', title: 'Черновик' },
        ]),
    })
    render(<App />)

    const list = await openNews()
    const published = await within(list).findByRole('article', { name: 'Новое меню' })

    // Двадцать два — форма «просмотра», а не «просмотров» (docs/04, раздел 7).
    expect(within(published).getByText(/22 просмотра/)).toBeInTheDocument()

    const draft = within(list).getByRole('article', { name: 'Черновик' })
    expect(within(draft).queryByText(/просмотр/)).toBeNull()
  })

  it('МЕНЕДЖЕР ВИДИТ НОВОСТИ БЕЗ ФОРМЫ И БЕЗ КНОПОК ПУБЛИКАЦИИ', async () => {
    stubApi({ '/v1/admin/news': () => json([NEWS]) })
    render(<App />)

    const list = await openNews()

    expect(await within(list).findByRole('article', { name: 'Новое меню' })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: t('news.publish') })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: t('news.form.title') })).not.toBeInTheDocument()
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

const TIER_SETTINGS = {
  tiers: [
    { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 20, hidden: false, conditions: [] },
    {
      id: 'gold',
      name: 'Золото',
      earnRate: 10,
      redeemRate: 50,
      hidden: false,
      conditions: [{ type: 'SPENT_TOTAL', gt: 1_000_000 }],
    },
  ],
  welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_FIRST_PURCHASE' },
}

/** Порог подозрительных чеков: по умолчанию. */
const SUSPICIOUS_SETTINGS = { maxChecksPerDay: 5 }

/** Автоответы на отзывы: не заданы. */
const REVIEW_SETTINGS = { autoReplies: [null, null, null, null, null] }

/** Подарок ко дню рождения: не включался. */
const BIRTHDAY_SETTINGS = {
  enabled: false,
  reward: { kind: 'POINTS', amount: 10_000 },
  daysBefore: 3,
  daysAfter: 3,
}

/** Приглашения друзей заведения: не включались. */
const REFERRAL_SETTINGS = { enabled: false, reward: 0, limit: 10 }
const STAFF_REWARD_SETTINGS = {
  enabled: false,
  basis: 'PER_NEW_GUEST',
  value: 0,
  vesting: 'ON_SECOND_VISIT',
  shiftCap: 15,
}

/** Теги заведения: один стоит на госте, второй — чтобы было что отметить. */
const TAG_VIP = { id: '16161616-1616-4161-8161-161616161616', name: 'VIP', color: 'amber' }
const TAG_BLOGGER = { id: '17171717-1717-4171-8171-171717171717', name: 'Блогер', color: 'violet' }

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
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
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

  it('ДОПЛАТА КАССИРАМ: ВКЛЮЧИЛИ, ЗАДАЛИ СУММУ — УШЛО В САТАНГАХ, СО СТОИМОСТЬЮ НА ЭКРАНЕ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/reports/staff': () =>
        json({
          period: '30d',
          staff: [
            {
              staffId: '22222222-2222-4222-8222-222222222222',
              displayName: 'Сомчай',
              role: 'CASHIER',
              isActive: true,
              operations: 300,
              turnover: 3_000_000,
              newGuests: 60,
              reviews: 0,
              rating: null,
              earned: 0,
              earnedPending: 0,
            },
          ],
          system: {
            operations: 0,
            turnover: 0,
            newGuests: 0,
            reviews: 0,
            rating: null,
            earned: 0,
            earnedPending: 0,
          },
        }),
      '/v1/admin/settings/program/staff-reward': (init) =>
        init?.method === 'PUT'
          ? json(JSON.parse(init.body as string))
          : json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    const section = within(await screen.findByRole('region', { name: t('staffReward.title') }))
    fireEvent.click(section.getByRole('checkbox', { name: new RegExp(t('staffReward.enabled')) }))

    fireEvent.change(await section.findByLabelText(t('staffReward.valueFixed')), {
      target: { value: '100' },
    })

    // Шестьдесят новых гостей за месяц по 100 ฿ — это 6 000 ฿ в месяц и пятая
    // часть выручки. Владелец видит цену решения до того, как его принял.
    expect(await section.findByTestId('staff-reward-forecast')).toHaveTextContent(/6 000/)

    fireEvent.click(section.getByRole('button', { name: t('staffReward.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/settings/program/staff-reward') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        enabled: true,
        basis: 'PER_NEW_GUEST',
        value: 10_000,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      })
    })
  })

  it('ПОТОЛОК ЧЕКА УХОДИТ В САТАНГАХ, А НЕ В БАТАХ', async () => {
    // Владелец пишет «3000» и думает батами. Касса считает сатангами. Перепутать
    // — значит поставить потолок в 30 ฿, и касса откажет на первом же обеде.
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
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
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
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
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()

    expect(screen.getByRole('button', { name: t('settings.save') })).toBeDisabled()
  })

  it('УДАЛЕНИЕ ТЕГА ПЕРЕСПРАШИВАЕТ: ТЕГ СОЙДЁТ СО ВСЕХ ГОСТЕЙ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/tags': (init) =>
        init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json([TAG_VIP]),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    const deleted = (): boolean =>
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
    render(<App />)

    await openSettings()
    const section = screen.getByRole('region', { name: t('tagSettings.title') })

    fireEvent.click(
      await within(section).findByRole('button', {
        name: fill(t('tagSettings.delete'), { name: 'VIP' }),
      }),
    )
    expect(
      within(section).getByText(fill(t('tagSettings.confirm'), { name: 'VIP' })),
    ).toBeInTheDocument()
    expect(deleted()).toBe(false)

    fireEvent.click(within(section).getByRole('button', { name: t('tagSettings.deleteYes') }))

    await waitFor(() => {
      expect(deleted()).toBe(true)
    })
  })

  it('НАГРАДА ЗА ДРУГА НАБИРАЕТСЯ В БАТАХ И УХОДИТ В САТАНГАХ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': (init) =>
        init?.method === 'PUT' ? json(JSON.parse(init.body as string)) : json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()
    const section = screen.getByRole('region', { name: t('referral.title') })

    fireEvent.click(await within(section).findByLabelText(t('referral.enabled')))
    fireEvent.change(within(section).getByLabelText(t('referral.reward')), {
      target: { value: '75' },
    })
    fireEvent.change(within(section).getByLabelText(t('referral.limit')), {
      target: { value: '3' },
    })
    fireEvent.click(within(section).getByRole('button', { name: t('referral.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/referral') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        enabled: true,
        reward: 7_500,
        limit: 3,
      })
    })

    expect(await within(section).findByText(t('referral.saved'))).toBeInTheDocument()
  })

  it('включённая награда без суммы не отправляется и объясняется рядом', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await openSettings()
    const section = screen.getByRole('region', { name: t('referral.title') })

    fireEvent.click(await within(section).findByLabelText(t('referral.enabled')))

    expect(within(section).getByText(t('referral.problem.reward'))).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: t('referral.save') })).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/referral') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toBe(false)
  })
})

const CHANNEL_ID = '19191919-1919-4191-8191-191919191919'

/** Источник заведения: табличка на столе с кодом, который выдал сервер. */
const TABLE_CHANNEL = {
  id: CHANNEL_ID,
  name: 'Табличка на столе',
  code: 'TBR2K7QX',
  isActive: true,
}

describe('Источники в настройках', () => {
  const openSources = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    return screen.findByRole('region', { name: t('channelSettings.title') })
  }

  const settingsApi = {
    '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
    '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
    '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
    '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
    '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
    '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
    '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
  }

  it('ВЛАДЕЛЕЦ ЗАВОДИТ ИСТОЧНИК И ПОЛУЧАЕТ ГОТОВУЮ ССЫЛКУ ДЛЯ ТАБЛИЧКИ', async () => {
    let channels: unknown[] = []
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/channels': (init) => {
        if (init?.method === 'POST') {
          channels = [TABLE_CHANNEL]
          return json(TABLE_CHANNEL, 201)
        }
        return json(channels)
      },
      ...settingsApi,
    })
    render(<App />)

    const section = await openSources()

    fireEvent.change(await within(section).findByLabelText(t('channelSettings.name')), {
      target: { value: 'Табличка на столе' },
    })
    fireEvent.click(within(section).getByRole('button', { name: t('channelSettings.create') }))

    const link = await within(section).findByLabelText(
      fill(t('channelSettings.link'), { name: 'Табличка на столе' }),
    )
    // Ссылка ведёт в приложение гостя, в это заведение, с кодом источника.
    expect(link).toHaveValue(
      `${GUEST_URL}/?venue=${OWNER_TOKENS.subject.tenantId}&src=${TABLE_CHANNEL.code}`,
    )

    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestOf(input as RequestInfo | URL).endsWith('/admin/channels') &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      name: 'Табличка на столе',
    })
  })

  it('источник выключается, а не удаляется', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/channels': (init) =>
        init?.method === 'PATCH'
          ? json({ ...TABLE_CHANNEL, isActive: false })
          : json([TABLE_CHANNEL]),
      ...settingsApi,
    })
    render(<App />)

    const section = await openSources()

    fireEvent.click(
      await within(section).findByRole('button', { name: t('channelSettings.disable') }),
    )

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      expect(requestOf(patch?.[0] as RequestInfo | URL)).toContain(`/admin/channels/${CHANNEL_ID}`)
      expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ isActive: false })
    })
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(false)
  })
})

/** Отчёт за месяц: табличка принесла деньги, флаер выключен, остальные пришли сами. */
const CHANNEL_REPORT = {
  period: '30d',
  channels: [
    {
      channelId: CHANNEL_ID,
      name: TABLE_CHANNEL.name,
      code: TABLE_CHANNEL.code,
      isActive: true,
      guests: 24,
      buyers: 17,
      revenue: 1_850_000,
    },
    {
      channelId: '20202020-2020-4202-8202-202020202020',
      name: 'Флаер на пляже',
      code: 'FRY7QXR2',
      isActive: false,
      guests: 0,
      buyers: 0,
      revenue: 0,
    },
  ],
  unattributed: { guests: 61, buyers: 40, revenue: 5_120_000 },
}

describe('Отчёты', () => {
  it('ИСТОЧНИКИ: ГОСТИ, ПОКУПАТЕЛИ И ВЫРУЧКА — И ОТДЕЛЬНО ТЕ, КТО ПРИШЁЛ БЕЗ ИСТОЧНИКА', async () => {
    const fetchMock = stubApi({ '/v1/admin/reports/channels': () => json(CHANNEL_REPORT) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reports') }))
    fireEvent.click(await screen.findByRole('tab', { name: t('reports.tab.channels') }))

    const table = await screen.findByRole('table', { name: t('reports.channels.title') })
    const tableRow = within(table).getByRole('row', { name: /Табличка на столе/ })

    expect(within(tableRow).getByText('24')).toBeInTheDocument()
    expect(within(tableRow).getByText('17')).toBeInTheDocument()
    // Выручка в батах, хотя пришла в сатангах.
    expect(within(tableRow).getByText(/18\s500,00 ฿/)).toBeInTheDocument()
    expect(within(table).getByText(t('reports.channels.off'))).toBeInTheDocument()

    const rest = within(table).getByRole('row', {
      name: new RegExp(t('reports.channels.unattributed')),
    })
    expect(within(rest).getByText(/51\s200,00 ฿/)).toBeInTheDocument()

    // По умолчанию — месяц; неделя запрашивается по нажатию.
    expect(requested(fetchMock, 'period=30d')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: t('overview.period.7d') }))
    await waitFor(() => {
      expect(requested(fetchMock, 'period=7d')).toBe(true)
    })
  })

  it('источников нет — владельцу подсказка, где их завести', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reports') }))
    fireEvent.click(await screen.findByRole('tab', { name: t('reports.tab.channels') }))

    expect(await screen.findByText(t('reports.channels.empty.owner'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('reports.channels.toSettings') })).toHaveAttribute(
      'href',
      '/settings',
    )
  })
})

const RFM_SEGMENTS = [
  'CHAMPIONS',
  'LOYAL',
  'POTENTIAL',
  'NEW',
  'PROMISING',
  'NEED_ATTENTION',
  'ABOUT_TO_SLEEP',
  'AT_RISK',
  'CANT_LOSE',
  'HIBERNATING',
] as const

describe('Отчёты: вкладки', () => {
  const openReports = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reports') }))
    await screen.findByRole('tablist', { name: t('reports.tabs.label') })
  }

  it('КЛИЕНТЫ ПО УМОЛЧАНИЮ: ВСЕГО, ПОКУПАТЕЛИ С ДОЛЕЙ, НОВЫЕ ЗА ПЕРИОД', async () => {
    stubApi({
      '/v1/admin/reports/customers': () =>
        json({
          period: '30d',
          total: 748,
          buyers: 512,
          buyersPct: 68.4,
          newGuests: 61,
          firstPurchases: 44,
          tourists: 430,
          residents: 318,
          series: [{ date: '2026-09-16', newGuests: 3, firstPurchases: 2 }],
        }),
    })
    render(<App />)

    await openReports()

    expect(screen.getByRole('tab', { name: t('reports.tab.customers') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByText('748')).toBeInTheDocument()
    expect(
      screen.getByText(fill(t('reports.customers.buyersPct'), { pct: '68,4' })),
    ).toBeInTheDocument()
    expect(
      screen.getByText(fill(t('reports.customers.firstPurchases'), { n: 44 })),
    ).toBeInTheDocument()
  })

  it('ОПЕРАЦИИ: ВЫРУЧКА ДЕНЬГАМИ, ОТМЕНЫ И БАЛЛЫ — А ВКЛАДКА ЖИВЁТ В АДРЕСЕ', async () => {
    stubApi({
      '/v1/admin/reports/operations': () =>
        json({
          period: '30d',
          turnover: 18_450_000,
          purchases: 402,
          averageCheck: 45_895,
          earned: 922_500,
          redeemed: 310_000,
          voided: 6,
          series: [{ date: '2026-09-16', turnover: 640_000, purchases: 14 }],
        }),
    })
    render(<App />)

    await openReports()
    fireEvent.click(screen.getByRole('tab', { name: t('reports.tab.operations') }))

    expect(await screen.findByText(/184\s500,00 ฿/)).toBeInTheDocument()
    expect(screen.getByText(fill(t('reports.operations.voided'), { n: 6 }))).toBeInTheDocument()
    expect(window.location.search).toContain('tab=operations')
  })

  it('RFM: СЕГМЕНТ С ГОСТЯМИ ВЕДЁТ В СПИСОК ГОСТЕЙ С ЭТИМ СЕГМЕНТОМ, ПЕРИОДА НЕТ', async () => {
    const fetchMock = stubApi({
      '/v1/admin/reports/rfm': () =>
        json({
          buyers: 2,
          segments: RFM_SEGMENTS.map((segment) =>
            segment === 'AT_RISK'
              ? { segment, guests: 2, purchases: 9, averageCheck: 50_000, turnover: 450_000 }
              : { segment, guests: 0, purchases: 0, averageCheck: null, turnover: 0 },
          ),
        }),
    })
    render(<App />)

    await openReports()
    fireEvent.click(screen.getByRole('tab', { name: t('reports.tab.rfm') }))

    const atRisk = await screen.findByRole('link', { name: t('rfm.AT_RISK') })
    // Пустой сегмент — не ссылка: вести в пустой список незачем.
    expect(screen.queryByRole('link', { name: t('rfm.CHAMPIONS') })).not.toBeInTheDocument()
    // RFM — срез «на сегодня», переключателя периода нет.
    expect(
      screen.queryByRole('group', { name: t('overview.period.label') }),
    ).not.toBeInTheDocument()

    fireEvent.click(atRisk)

    expect(
      await screen.findByRole('heading', { level: 1, name: t('guests.title') }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(requested(fetchMock, 'segment=AT_RISK')).toBe(true)
    })
    expect(screen.getByLabelText(t('guests.filter.segment'))).toHaveValue('AT_RISK')
  })

  it('СОТРУДНИКИ: ЧЕКИ, ВЫРУЧКА И НОВЫЕ ГОСТИ — И ОТДЕЛЬНО ЧЕКИ ИЗ КАССЫ POSITIVE', async () => {
    stubApi({
      '/v1/admin/reports/staff': () =>
        json({
          period: '30d',
          staff: [
            {
              staffId: '22222222-2222-4222-8222-222222222222',
              displayName: 'Сомчай',
              role: 'CASHIER',
              isActive: true,
              operations: 212,
              turnover: 9_650_000,
              newGuests: 31,
              reviews: 24,
              rating: 4.8,
              earned: 120_000,
              earnedPending: 40_000,
            },
          ],
          system: {
            operations: 190,
            turnover: 8_800_000,
            newGuests: 13,
            reviews: 0,
            rating: null,
            earned: 0,
            earnedPending: 0,
          },
        }),
    })
    render(<App />)

    await openReports()
    fireEvent.click(screen.getByRole('tab', { name: t('reports.tab.staff') }))

    const table = await screen.findByRole('table', { name: t('reports.tab.staff') })
    const cashier = within(table).getByRole('row', { name: /Сомчай/ })
    expect(within(cashier).getByText('212')).toBeInTheDocument()
    expect(within(cashier).getByText('31')).toBeInTheDocument()

    expect(within(cashier).getByText('4.8 · 24')).toBeInTheDocument()
    // Недозревшее — в скобках: эти деньги заведение ещё не должно.
    expect(within(cashier).getByText(/1 200.*400/)).toBeInTheDocument()

    const system = within(table).getByRole('row', { name: new RegExp(t('reports.staff.system')) })
    expect(within(system).getByText('190')).toBeInTheDocument()
    // Чеки из кассы некому оценивать и некому платить — два прочерка, а не нули.
    expect(within(system).getAllByText('—')).toHaveLength(2)
  })
})

const CERTIFICATE = {
  id: '81818181-8181-4818-8818-818181818181',
  title: 'Сертификат на 500 ฿',
  value: { kind: 'FIXED_OFF', amount: 50_000 },
  validityDays: 30,
  isActive: true,
  issued: 12,
  redeemed: 7,
}

describe('Сертификаты', () => {
  const openCertificates = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.offers') }))
    fireEvent.click(await screen.findByRole('tab', { name: t('offers.tab.certificates') }))
    return screen.findByRole('region', { name: t('certificates.title') })
  }

  it('ВЛАДЕЛЕЦ ЗАВОДИТ СЕРТИФИКАТ НА 500 ฿ — НОМИНАЛ УХОДИТ В САТАНГАХ', async () => {
    let certificates: unknown[] = []
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/certificates': (init) => {
        if (init?.method === 'POST') {
          certificates = [CERTIFICATE]
          return json(CERTIFICATE, 201)
        }
        return json(certificates)
      },
    })
    render(<App />)

    await openCertificates()

    const form = await screen.findByRole('form', { name: t('certificates.form.title') })
    fireEvent.change(within(form).getByLabelText(t('certificates.field.title')), {
      target: { value: 'Сертификат на 500 ฿' },
    })
    fireEvent.change(within(form).getByLabelText(t('certificates.field.amount')), {
      target: { value: '500' },
    })
    fireEvent.click(within(form).getByRole('button', { name: t('certificates.create') }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/admin/certificates') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
        title: 'Сертификат на 500 ฿',
        value: { kind: 'FIXED_OFF', amount: 50_000 },
        validityDays: 30,
      })
    })

    const table = await screen.findByRole('table', { name: t('certificates.title') })
    expect(within(table).getByText('Сертификат на 500 ฿')).toBeInTheDocument()
  })

  it('СЧЁТЧИКИ «ВЫДАНО / ИСПОЛЬЗОВАНО» ВИДНЫ, СЕРТИФИКАТ ВЫКЛЮЧАЕТСЯ, А НЕ УДАЛЯЕТСЯ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/certificates': (init) =>
        init?.method === 'PATCH' ? json({ ...CERTIFICATE, isActive: false }) : json([CERTIFICATE]),
    })
    render(<App />)

    const section = await openCertificates()

    const row = await within(section).findByRole('row', { name: /Сертификат на 500 ฿/ })
    expect(within(row).getByText('12')).toBeInTheDocument()
    expect(within(row).getByText('7')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: t('certificates.disable') }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ isActive: false })
    })
  })

  it('ПОДАРИТЬ СЕРТИФИКАТ: НАЗВАНИЕ И СРОК — ИЗ ШАБЛОНА, ПОЛЯ «ЧТО ДАРИМ» НЕТ', async () => {
    const fetchMock = stubApi({
      '/v1/admin/certificates': () => json([CERTIFICATE]),
      [`/v1/admin/guests/${GUEST_ID}/gifts`]: () =>
        json(
          {
            grantId: '72727272-7272-4727-8727-727272727272',
            title: 'Сертификат на 500 ฿',
            codeTail: 'K4ZP',
            expiresAt: '2026-10-16T12:00:00.000Z',
            replayed: false,
          },
          201,
        ),
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.guests') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    const card = await screen.findByRole('dialog', { name: 'Анна Ковалёва' })

    fireEvent.click(within(card).getByRole('button', { name: t('gift.open') }))
    fireEvent.change(await within(card).findByLabelText(t('gift.certificate')), {
      target: { value: CERTIFICATE.id },
    })

    expect(within(card).queryByLabelText(t('gift.what'))).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: t('gift.reason.CELEBRATION') }))
    fireEvent.click(within(card).getByRole('button', { name: t('gift.submit') }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/gifts') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      const body = JSON.parse((post?.[1] as RequestInit).body as string) as Record<string, unknown>
      expect(body).toMatchObject({ certificateId: CERTIFICATE.id, reason: 'CELEBRATION' })
      expect(body).not.toHaveProperty('title')
    })
  })

  it('ДЕНЬ РОЖДЕНИЯ: СЕРТИФИКАТ ИЗ ШАБЛОНА И ОКНО ДНЕЙ УХОДЯТ В НАСТРОЙКИ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/certificates': () => json([CERTIFICATE]),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': (init) =>
        init?.method === 'PUT' ? json(JSON.parse(init.body as string)) : json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    const section = await screen.findByRole('region', { name: t('birthday.title') })

    fireEvent.click(await within(section).findByLabelText(t('birthday.enabled')))
    fireEvent.change(within(section).getByLabelText(t('birthday.kind')), {
      target: { value: 'CERTIFICATE' },
    })
    fireEvent.change(await within(section).findByLabelText(t('birthday.certificate')), {
      target: { value: CERTIFICATE.id },
    })
    fireEvent.change(within(section).getByLabelText(t('birthday.daysBefore')), {
      target: { value: '5' },
    })
    fireEvent.click(within(section).getByRole('button', { name: t('birthday.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/birthday') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        enabled: true,
        reward: { kind: 'CERTIFICATE', certificateId: CERTIFICATE.id },
        daysBefore: 5,
        daysAfter: 3,
      })
    })
  })
})

const REVIEW = {
  id: '91919191-9191-4919-8919-919191919191',
  rating: 2,
  tags: ['SERVICE', 'STAFF'],
  comment: 'Ждали заказ сорок минут',
  reply: 'Нам очень жаль. Напишите, что случилось, — разберёмся.',
  repliedAt: '2026-09-15T13:02:11.000Z',
  autoReply: true,
  createdAt: '2026-09-15T13:02:11.000Z',
  guest: {
    guestId: '92929292-9292-4929-8929-929292929292',
    membershipId: '93939393-9393-4939-8939-939393939393',
    displayName: 'Анна Ковалёва',
    phone: '+66 •• •• 4821',
  },
  staff: { id: '94949494-9494-4949-8949-949494949494', displayName: 'Сомчай' },
  amount: 45_000,
}

const REVIEWS_LIST = {
  period: '30d',
  summary: {
    total: 1,
    average: 2,
    distribution: [0, 1, 0, 0, 0],
    tags: [
      { tag: 'SERVICE', count: 1 },
      { tag: 'STAFF', count: 1 },
      { tag: 'QUALITY', count: 0 },
      { tag: 'PRICE', count: 0 },
      { tag: 'ASSORTMENT', count: 0 },
    ],
    unanswered: 0,
  },
  total: 1,
  items: [REVIEW],
}

describe('Отзывы', () => {
  it('МЕНЕДЖЕР ВИДИТ СВОДКУ И ОТЗЫВ С КАССИРОМ; АВТООТВЕТ ЗАМЕНЯЕТ СВОИМ ОТВЕТОМ', async () => {
    const fetchMock = stubApi({
      [`/v1/admin/reviews/${REVIEW.id}/reply`]: () =>
        json({ ...REVIEW, reply: 'Разобрались с кухней.', autoReply: false }),
      '/v1/admin/reviews': () => json(REVIEWS_LIST),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reviews') }))

    const summary = await screen.findByRole('region', { name: t('reviews.summary') })
    expect(within(summary).getByText('2,0')).toBeInTheDocument()

    const card = await screen.findByRole('article', { name: /Анна Ковалёва/ })
    expect(within(card).getByText(/Сомчай/)).toBeInTheDocument()
    expect(within(card).getByText(t('reviews.autoReply'))).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Анна Ковалёва' })).toHaveAttribute(
      'href',
      `/guests?guest=${REVIEW.guest.guestId}`,
    )

    fireEvent.click(within(card).getByRole('button', { name: t('reviews.replyYourself') }))
    fireEvent.change(within(card).getByLabelText(t('reviews.replyLabel')), {
      target: { value: '  Разобрались с кухней.  ' },
    })
    fireEvent.click(within(card).getByRole('button', { name: t('reviews.send') }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/reply') &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
        text: 'Разобрались с кухней.',
      })
    })
  })

  it('ФИЛЬТРЫ «ЖДУТ ОТВЕТА» И ОЦЕНКА УХОДЯТ В ЗАПРОС', async () => {
    const fetchMock = stubApi({ '/v1/admin/reviews': () => json(REVIEWS_LIST) })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.reviews') }))

    const answer = await screen.findByRole('group', { name: t('reviews.filter.answer') })
    fireEvent.click(within(answer).getByRole('button', { name: t('reviews.filter.unanswered') }))
    const rating = screen.getByRole('group', { name: t('reviews.filter.rating') })
    fireEvent.click(within(rating).getByRole('button', { name: '★ 2' }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => requestOf(input as RequestInfo | URL))
      expect(
        urls.some(
          (url) =>
            url.includes('/admin/reviews?') &&
            url.includes('answered=no') &&
            url.includes('rating=2'),
        ),
      ).toBe(true)
    })
  })

  it('АВТООТВЕТЫ В НАСТРОЙКАХ: ПУСТОЕ ПОЛЕ — БЕЗ АВТООТВЕТА', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': (init) =>
        init?.method === 'PUT' ? json(JSON.parse(init.body as string)) : json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    const section = await screen.findByRole('region', { name: t('reviewReplies.title') })

    fireEvent.change(
      await within(section).findByLabelText(t('reviewReplies.rating').replace('{n}', '5')),
      { target: { value: ' Спасибо! Ждём вас снова. ' } },
    )
    fireEvent.click(within(section).getByRole('button', { name: t('reviewReplies.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/program/reviews') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        autoReplies: [null, null, null, null, 'Спасибо! Ждём вас снова.'],
      })
    })
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
      source: 'ORGANIC',
      firstVisitAt: '2026-08-20T12:00:00.000Z',
      tier: { id: 'gold', name: 'Золото' },
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
  tier: { id: 'gold', name: 'Золото', manual: false },
  note: 'Аллергия на арахис',
  tags: [TAG_VIP],
  referral: { invitedBy: null, invited: 2, rewarded: 1 },
  channel: { id: CHANNEL_ID, name: 'Табличка на столе' },
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

  it('ЗАМЕТКА И ТЕГИ ВИДНЫ СРАЗУ, А «БАЛЛЫ ВРУЧНУЮ» — ТОЛЬКО У ВЛАДЕЛЬЦА', async () => {
    // «Аллергия на арахис» нужна у стойки без лишнего нажатия. Баланс — деньги
    // владельца: менеджер кнопки не видит, а сервер ему всё равно откажет.
    stubApi({
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await openGuests()
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    const card = await screen.findByRole('dialog', { name: 'Анна Ковалёва' })

    expect(within(card).getByText('Аллергия на арахис')).toBeInTheDocument()
    expect(within(card).getByText('VIP')).toBeInTheDocument()
    expect(
      within(card).getByText(fill(t('guestCard.channel'), { name: 'Табличка на столе' })),
    ).toBeInTheDocument()
    // Скольких друзей привёл и за скольких получил баллы — в шапке, рядом с визитом.
    expect(
      within(card).getByText(fill(t('guestCard.referral.count'), { invited: 2, rewarded: 1 })),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: t('noteForm.edit') })).toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: t('pointsForm.open') }),
    ).not.toBeInTheDocument()
  })

  it('ВЛАДЕЛЕЦ СПИСЫВАЕТ 150 ฿ — УХОДИТ −15 000 САТАНГ С ПРИЧИНОЙ И КЛЮЧОМ ПОВТОРА', async () => {
    // Списание — переключателем, а не минусом в поле: сумма набирается
    // положительной, знак ставит форма. Ключ повтора — чтобы второе нажатие
    // при обрыве связи не списало дважды.
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      [`/v1/admin/guests/${GUEST_ID}/points`]: () =>
        json({
          entryId: '18181818-1818-4181-8181-181818181818',
          amount: -15_000,
          balance: 15_175,
          replayed: false,
        }),
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await openGuests()
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    const card = await screen.findByRole('dialog', { name: 'Анна Ковалёва' })

    fireEvent.click(within(card).getByRole('button', { name: t('pointsForm.open') }))
    fireEvent.click(within(card).getByRole('button', { name: t('pointsForm.spend') }))
    fireEvent.change(within(card).getByLabelText(t('pointsForm.amount')), {
      target: { value: '150' },
    })
    fireEvent.change(within(card).getByLabelText(t('pointsForm.reason')), {
      target: { value: 'Гость вернул заказ' },
    })
    fireEvent.click(within(card).getByRole('button', { name: t('pointsForm.submitSpend') }))

    // Форма закрылась — сервер принял правку.
    await waitFor(() => {
      expect(within(card).queryByLabelText(t('pointsForm.amount'))).not.toBeInTheDocument()
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      requestOf(input as RequestInfo | URL).endsWith('/points'),
    )
    const init = call?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      amount: -15_000,
      reason: 'Гость вернул заказ',
    })
    expect(new Headers(init.headers).get('Idempotency-Key')).toMatch(/^[\w-]{8,}$/)
  })

  it('ТЕГИ ГОСТЯ СОХРАНЯЮТСЯ НАБОРОМ: ЧТО ОТМЕЧЕНО ГАЛОЧКАМИ, ТО И УШЛО', async () => {
    const fetchMock = stubApi({
      '/v1/admin/tags': () => json([TAG_VIP, TAG_BLOGGER]),
      [`/v1/admin/guests/${GUEST_ID}/tags`]: () => json({ tags: [TAG_VIP, TAG_BLOGGER] }),
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await openGuests()
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    const card = await screen.findByRole('dialog', { name: 'Анна Ковалёва' })

    fireEvent.click(within(card).getByRole('button', { name: t('tagsForm.edit') }))
    fireEvent.click(await within(card).findByRole('checkbox', { name: 'Блогер' }))
    expect(within(card).getByRole('checkbox', { name: 'VIP' })).toBeChecked()
    fireEvent.click(within(card).getByRole('button', { name: t('tagsForm.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).endsWith('/tags') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        tagIds: [TAG_VIP.id, TAG_BLOGGER.id],
      })
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
    json(
      {
        partnershipId: PARTNERSHIP_ID,
        quota: { freeLimit: 3, freeUsed: 1, freeLeft: 2, restriction: null },
      },
      201,
    ),
  '/v1/admin/partnerships/quota': () =>
    json({ freeLimit: 3, freeUsed: 0, freeLeft: 3, restriction: null }),
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

const NO_OFFER_ACTIONS = { publish: false, pause: false, end: false }

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
      actions: NO_OFFER_ACTIONS,
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
      actions: NO_OFFER_ACTIONS,
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

/** Входящее приглашение, которое ждёт нашего ответа. */
const WAITING_INVITE = {
  ...INCOMING_INVITE,
  endReason: null,
  terms: [],
  messages: NEGOTIATING_PARTNERSHIP.messages,
  actions: { accept: true, decline: true, end: false, block: true, message: false },
}

const COOLING_UNTIL = '2026-10-15T12:00:00.000Z'

describe('Партнёры: антиспам', () => {
  const openPartnership = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('link', { name: t('nav.partners') }))
    fireEvent.click(await screen.findByRole('link', { name: /Dance Studio Kata/ }))
    await screen.findByRole('heading', { level: 1, name: 'Dance Studio Kata' })
  }

  const openCatalog = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('link', { name: t('nav.partners') }))
    await screen.findByRole('heading', { level: 1, name: t('partners.title') })
    fireEvent.click(screen.getByRole('tab', { name: t('partners.tab.catalog') }))
  }

  it('ВХОДЯЩЕЕ ПРИГЛАШЕНИЕ БЛОКИРУЮТ С ЖАЛОБОЙ «СПАМ» — ГАЛОЧКОЙ В ПОДТВЕРЖДЕНИИ', async () => {
    const fetchMock = stubApi(
      partnersApi({
        '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
        [`/v1/admin/partnerships/${PARTNERSHIP_ID}`]: () => json(WAITING_INVITE),
      }),
    )
    render(<App />)

    await fillAndSubmitLogin()
    await openPartnership()

    fireEvent.click(screen.getByRole('button', { name: t('partner.action.block') }))
    fireEvent.click(screen.getByRole('checkbox', { name: t('partner.confirm.spam') }))
    expect(screen.getByText(t('partner.confirm.spamHint'))).toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: t('partner.action.block'),
      }),
    )

    await waitFor(() => {
      expect(postedTo(fetchMock, `/partnerships/${PARTNERSHIP_ID}/block`)).toEqual({ spam: true })
    })
  })

  it('на идущий разговор жалобы нет — только блокировка', async () => {
    const fetchMock = stubApi(partnersApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) }))
    render(<App />)

    await fillAndSubmitLogin()
    await openPartnership()

    fireEvent.click(screen.getByRole('button', { name: t('partner.action.block') }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: t('partner.action.block') }))

    await waitFor(() => {
      expect(postedTo(fetchMock, `/partnerships/${PARTNERSHIP_ID}/block`)).toEqual({})
    })
  })

  it('на охлаждении каталог называет дату, до которой приглашение одно в день', async () => {
    stubApi(
      partnersApi({
        '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
        '/v1/admin/partnerships/quota': () =>
          json({
            freeLimit: 1,
            freeUsed: 0,
            freeLeft: 1,
            restriction: { kind: 'COOLING', until: COOLING_UNTIL },
          }),
      }),
    )
    render(<App />)

    await fillAndSubmitLogin()
    await openCatalog()

    expect(
      await screen.findByText(
        fill(t('partners.catalog.cooling'), { date: formatDate(COOLING_UNTIL) }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('partners.catalog.invite') })).toBeInTheDocument()
  })

  it('ПРИОСТАНОВЛЕННОМУ КНОПОК «ПРИГЛАСИТЬ» НЕТ — ТОЛЬКО ОБЪЯСНЕНИЕ', async () => {
    stubApi(
      partnersApi({
        '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
        '/v1/admin/partnerships/quota': () =>
          json({ freeLimit: 0, freeUsed: 0, freeLeft: 0, restriction: { kind: 'SUSPENDED' } }),
      }),
    )
    render(<App />)

    await fillAndSubmitLogin()
    await openCatalog()

    expect(await screen.findByText(t('partners.catalog.suspended'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('partners.catalog.invite') })).toBeNull()
  })
})

const CASHBACK_OFFER = '91919191-9191-4919-8919-919191919191'
const PROMO_OFFER = '92929292-9292-4929-8929-929292929292'
const WEEKEND_OFFER = '93939393-9393-4939-8939-939393939393'

describe('Касса: акции в чеке', () => {
  const reachConfirm = async (): Promise<void> => {
    await fillAndSubmitLogin()

    fireEvent.change(await screen.findByLabelText(t('pos.phone.label')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.phone.find') }))
    expect(await screen.findByText(POS_GUEST.displayName)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('pos.amount.label')), { target: { value: '900' } })
    fireEvent.change(await screen.findByLabelText(t('pos.receipt.required')), {
      target: { value: 'A-3001' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('pos.amount.next') }))
  }

  it('ПРЕДРАСЧЁТ ОБЪЯСНЯЕТ АКЦИИ, ЭКРАН УСПЕХА ГОВОРИТ О ВЫДАННОМ ПРОМОКОДЕ', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(CASHIER_TOKENS),
      '/v1/pos/transactions/preview': () =>
        json({
          ...POS_PREVIEW,
          amount: 90_000,
          amountToPay: 90_000,
          pointsToEarn: 13_500,
          appliedOffers: [
            {
              offerId: CASHBACK_OFFER,
              title: 'Кэшбэк 5%',
              earnDelta: 4_500,
              discountDelta: 0,
              grantAfterPayment: false,
            },
            {
              offerId: PROMO_OFFER,
              title: 'Вернём 200 ฿',
              earnDelta: 0,
              discountDelta: 0,
              grantAfterPayment: true,
            },
          ],
          skippedOffers: [
            {
              offerId: WEEKEND_OFFER,
              title: 'Выходные',
              reason: 'SCHEDULE',
              message: 'Сегодня акция не действует — только в свои дни недели',
            },
          ],
        }),
      '/v1/pos/transactions/commit': () =>
        json({
          ...POS_COMMIT,
          earned: 13_500,
          grantsIssued: [
            {
              grantId: '94949494-9494-4949-8949-949494949494',
              offerId: PROMO_OFFER,
              title: 'Вернём 200 ฿',
              codeTail: 'K2QP',
              expiresAt: '2026-08-28T12:00:00.000Z',
            },
          ],
        }),
    })
    render(<App />)

    await reachConfirm()

    const applied = await screen.findByRole('list', { name: t('pos.offers.applied') })
    expect(within(applied).getByText('Кэшбэк 5%')).toBeInTheDocument()
    expect(within(applied).getByText(`+${formatBaht(4_500)}`)).toBeInTheDocument()
    expect(within(applied).getByText(t('pos.offers.afterPayment'))).toBeInTheDocument()

    const skipped = screen.getByRole('list', { name: t('pos.offers.skipped') })
    expect(
      within(skipped).getByText('Сегодня акция не действует — только в свои дни недели'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('pos.confirm.submit') }))

    const issued = await screen.findByRole('list', { name: t('pos.offers.issued') })
    expect(
      within(issued).getByText(fill(t('pos.offers.issuedLine'), { title: 'Вернём 200 ฿' })),
    ).toBeInTheDocument()
    expect(within(issued).getByText('•••• K2QP')).toBeInTheDocument()
  })

  it('акций нет — на кассе нет и пустых блоков про акции', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await reachConfirm()

    expect(await screen.findByRole('button', { name: t('pos.confirm.submit') })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: t('pos.offers.applied') })).toBeNull()
    expect(screen.queryByRole('list', { name: t('pos.offers.skipped') })).toBeNull()
  })
})

describe('Каркас: левое меню', () => {
  it('ЛЕВОЕ МЕНЮ ВЛАДЕЛЬЦА: ВСЕ РАЗДЕЛЫ, ТЕКУЩИЙ ОТМЕЧЕН', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    const nav = await screen.findByRole('navigation', { name: t('nav.label') })
    const sections = [
      'nav.overview',
      'nav.reports',
      'nav.operations',
      'nav.guests',
      'nav.offers',
      'nav.partners',
      'nav.team',
      'nav.pos',
      'nav.saleKinds',
      'nav.settings',
    ] as const

    for (const section of sections) {
      expect(within(nav).getByRole('link', { name: t(section) })).toBeInTheDocument()
    }

    expect(within(nav).getByRole('link', { name: t('nav.overview') })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('на телефоне меню выдвигается кнопкой и закрывается после перехода', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(OWNER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    const toggle = await screen.findByRole('button', { name: t('nav.menu') })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('link', { name: t('nav.guests') }))

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('У КАССИРА БОКОВОГО МЕНЮ НЕТ — ТОЛЬКО КАССА', async () => {
    stubApi({ '/v1/auth/staff/pin': () => json(CASHIER_TOKENS) })
    render(<App />)

    await fillAndSubmitLogin()

    const nav = await screen.findByRole('navigation', { name: t('nav.label') })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([t('nav.pos')])
    expect(screen.queryByRole('button', { name: t('nav.menu') })).toBeNull()
  })
})

const NEW_OFFER_ID = '54545454-5454-4545-8545-545454545454'

/** Своя акция владельца: идёт, её можно поставить на паузу и завершить. */
const OWN_OFFER = {
  id: NEW_OFFER_ID,
  status: 'LIVE',
  title: 'Вернём 200 ฿',
  howTo: ['Покажите код на кассе', 'Скидка 200 ฿', 'Действует 1 день с выдачи'],
  partner: null,
  issued: 5,
  redeemed: 2,
  returned: 1,
  actions: { publish: false, pause: true, end: true },
  createdAt: '2026-09-15T10:00:00.000Z',
}

const SIMULATION = {
  insufficientData: false,
  days: 30,
  guests: 84,
  grants: 84,
  bonusPoints: null,
  cost: 1_680_000,
}

/** Как сумму видит поиск по тексту: неразрывные пробелы он сводит к обычным. */
const bahtText = (minor: number): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ฿`.replace(
    /\s/g,
    ' ',
  )

describe('Конструктор акций', () => {
  const openConstructor = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.offers') }))
    fireEvent.click(await screen.findByRole('link', { name: t('offers.create') }))
    await screen.findByRole('heading', { level: 1, name: t('offerNew.title') })
  }

  const pickTemplate = (name: Parameters<typeof t>[0]): void => {
    fireEvent.click(
      screen.getByRole('button', { name: (accessible) => accessible.startsWith(t(name)) }),
    )
  }

  it('ШАБЛОН → ЖИВОЕ ПРЕВЬЮ КАК У ГОСТЯ → ПРОГНОЗ → ЗАПУСК УХОДИТ НА СЕРВЕР ТЕМИ ЖЕ ПРАВИЛАМИ', async () => {
    const created: unknown[] = []
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/offers/simulate': () => json(SIMULATION),
      '/v1/admin/offers': (init) => {
        if (init?.method === 'POST') {
          created.push(JSON.parse(init.body as string))
          return json({ id: NEW_OFFER_ID, status: 'LIVE' }, 201)
        }

        return json({ items: [OWN_OFFER] })
      },
    })
    render(<App />)

    await openConstructor()
    pickTemplate('offerNew.template.RETURN_TOMORROW.name')

    const preview = await screen.findByRole('region', { name: t('offerNew.preview.title') })
    expect(
      within(preview).getByText(t('offerNew.template.RETURN_TOMORROW.title')),
    ).toBeInTheDocument()
    expect(within(preview).getByText('Скидка 200 ฿')).toBeInTheDocument()

    // Превью живое: правка суммы сразу видна в карточке гостя.
    fireEvent.change(screen.getByLabelText(t('offerNew.field.giftAmount')), {
      target: { value: '250' },
    })
    expect(within(preview).getByText('Скидка 250 ฿')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('offerNew.forecast.run') }))
    const forecast = screen.getByRole('region', { name: t('offerNew.forecast.title') })
    expect(await within(forecast).findByText(bahtText(1_680_000))).toBeInTheDocument()
    expect(requested(fetchMock, '/v1/admin/offers/simulate')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: t('offerNew.next') }))
    await screen.findByRole('heading', { level: 2, name: t('offerNew.review.title') })
    fireEvent.click(screen.getByRole('button', { name: t('offerNew.launch') }))

    await screen.findByRole('heading', { level: 1, name: t('offers.title') })
    expect(created).toEqual([
      {
        type: 'PROMO_ON_CHECK',
        title: t('offerNew.template.RETURN_TOMORROW.title'),
        audience: { kind: 'ALL' },
        schedule: {},
        limits: { minCheck: 80_000, perGuestQty: 1 },
        reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 25_000 }, validityDays: 1 },
        stackable: true,
        priority: 100,
        launch: 'NOW',
      },
    ])
  })

  it('СВОЯ АКЦИЯ С ЧИСТОГО ЛИСТА: «ДАЛЬШЕ» ЖДЁТ И ГОВОРИТ, ЧТО ПОПРАВИТЬ; ДАННЫХ МАЛО — ЧЕСТНАЯ СТРОКА', async () => {
    stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/offers/simulate': () =>
        json({
          insufficientData: true,
          reason: 'За 30 дней меньше 20 чеков — на такой истории прогноз случаен',
        }),
      '/v1/admin/offers': () => json({ items: [] }),
    })
    render(<App />)

    await openConstructor()
    pickTemplate('offerNew.template.CUSTOM.name')

    const next = await screen.findByRole('button', { name: t('offerNew.next') })
    expect(next).toBeDisabled()
    expect(screen.getByText(t('offerNew.problem.title'))).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('offerNew.field.title')), {
      target: { value: 'Минус 150 ฿' },
    })
    expect(screen.getByText(t('offerNew.problem.giftAmount'))).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('offerNew.field.giftAmount')), {
      target: { value: '150' },
    })
    expect(next).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: t('offerNew.forecast.run') }))
    expect(await screen.findByText(t('offerNew.forecast.noData'))).toBeInTheDocument()
    expect(
      screen.getByText('За 30 дней меньше 20 чеков — на такой истории прогноз случаен'),
    ).toBeInTheDocument()
  })

  it('ПАУЗА И ЗАВЕРШЕНИЕ С КАРТОЧКИ — ТОЛЬКО КНОПКИ, ДАННЫЕ СЕРВЕРОМ; ЗАВЕРШЕНИЕ ПЕРЕСПРАШИВАЕТ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/offers/': () => json({ id: NEW_OFFER_ID, status: 'PAUSED' }),
      '/v1/admin/offers': () => json({ items: [OWN_OFFER] }),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.offers') }))

    const actions = await screen.findByRole('group', { name: t('offers.action.label') })
    expect(within(actions).queryByRole('button', { name: t('offers.action.publish') })).toBeNull()

    fireEvent.click(within(actions).getByRole('button', { name: t('offers.action.pause') }))
    await waitFor(() => {
      expect(requested(fetchMock, `/v1/admin/offers/${NEW_OFFER_ID}/pause`)).toBe(true)
    })
    await waitFor(() => {
      expect(within(actions).getByRole('button', { name: t('offers.action.end') })).toBeEnabled()
    })

    fireEvent.click(within(actions).getByRole('button', { name: t('offers.action.end') }))
    expect(within(actions).getByText(t('offers.action.endConfirm'))).toBeInTheDocument()
    expect(requested(fetchMock, '/end')).toBe(false)

    fireEvent.click(within(actions).getByRole('button', { name: t('offers.action.endYes') }))
    await waitFor(() => {
      expect(requested(fetchMock, `/v1/admin/offers/${NEW_OFFER_ID}/end`)).toBe(true)
    })
  })

  it('менеджер видит акции без кнопок и без дороги в конструктор', async () => {
    stubApi({
      '/v1/admin/offers': () => json({ items: [{ ...OWN_OFFER, actions: NO_OFFER_ACTIONS }] }),
    })
    render(<App />)

    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.offers') }))

    await screen.findByRole('heading', { level: 2, name: 'Вернём 200 ฿' })
    expect(screen.queryByRole('link', { name: t('offers.create') })).toBeNull()
    expect(screen.queryByRole('group', { name: t('offers.action.label') })).toBeNull()
  })
})

describe('Статусы гостей в настройках', () => {
  const openTiers = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.settings') }))
    return screen.findByRole('region', { name: t('tiers.title') })
  }

  it('НОВЫЙ СТАТУС С ПОРОГОМ В БАТАХ УХОДИТ В САТАНГАХ, ПРИВЕТСТВЕННЫЕ БАЛЛЫ — ТОЖЕ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': (init) =>
        init?.method === 'PUT' ? json(JSON.parse(init.body as string)) : json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    const section = await openTiers()
    await within(section).findByRole('group', { name: fill(t('tiers.row'), { n: 2 }) })

    fireEvent.click(within(section).getByRole('button', { name: t('tiers.add') }))
    const third = within(section).getByRole('group', { name: fill(t('tiers.row'), { n: 3 }) })
    fireEvent.change(within(third).getByLabelText(t('tiers.name')), {
      target: { value: 'Платина' },
    })
    fireEvent.change(within(third).getByLabelText(t('tiers.earn')), { target: { value: '15' } })
    fireEvent.change(within(third).getByLabelText(t('tiers.redeem')), { target: { value: '70' } })
    fireEvent.change(within(third).getByLabelText(t('tiers.spentOver')), {
      target: { value: '50000' },
    })

    fireEvent.click(within(section).getByLabelText(t('tiers.welcome.enabled')))
    fireEvent.change(within(section).getByLabelText(t('tiers.welcome.amount')), {
      target: { value: '50' },
    })

    fireEvent.click(within(section).getByRole('button', { name: t('tiers.save') }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestOf(input as RequestInfo | URL).includes('/tiers') &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        tiers: [
          ...TIER_SETTINGS.tiers,
          {
            id: 'tier-1',
            name: 'Платина',
            earnRate: 15,
            redeemRate: 70,
            hidden: false,
            conditions: [{ type: 'SPENT_TOTAL', gt: 5_000_000 }],
          },
        ],
        welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
      })
    })
    expect(await within(section).findByText(t('tiers.saved'))).toBeInTheDocument()
  })

  it('ДВА СТАТУСА С ОДНИМ НАЗВАНИЕМ — НЕ ОТПРАВЛЯЕТСЯ, И СКАЗАНО ПОЧЕМУ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/settings/program': () => json(PROGRAM_SETTINGS),
    })
    render(<App />)

    const section = await openTiers()
    const second = await within(section).findByRole('group', {
      name: fill(t('tiers.row'), { n: 2 }),
    })
    fireEvent.change(within(second).getByLabelText(t('tiers.name')), { target: { value: 'гость' } })

    expect(within(section).getByText(t('tiers.problem.duplicateName'))).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: t('tiers.save') })).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(false)
  })
})

describe('Статус в карточке гостя', () => {
  const openCard = async (): Promise<HTMLElement> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.guests') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Анна Ковалёва' }))
    return screen.findByRole('dialog', { name: 'Анна Ковалёва' })
  }

  it('ВЛАДЕЛЕЦ НАЗНАЧАЕТ СКРЫТЫЙ СТАТУС — ТОЛЬКО С ПРИЧИНОЙ', async () => {
    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () =>
        json({
          ...TIER_SETTINGS,
          tiers: [
            ...TIER_SETTINGS.tiers,
            {
              id: 'friends',
              name: 'Друзья',
              earnRate: 20,
              redeemRate: 100,
              hidden: true,
              conditions: [],
            },
          ],
        }),
      [`/v1/admin/guests/${GUEST_ID}/tier`]: () =>
        json({ tierId: 'friends', name: 'Друзья', manual: true }),
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    const dialog = await openCard()
    expect(within(dialog).getByText('Золото')).toBeInTheDocument()

    fireEvent.click(await within(dialog).findByRole('button', { name: t('tierForm.open') }))
    fireEvent.change(within(dialog).getByLabelText(t('tierForm.tier')), {
      target: { value: 'friends' },
    })

    const submit = within(dialog).getByRole('button', { name: t('tierForm.submit') })
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(t('tierForm.reason')), {
      target: { value: 'Друг владельца, ходит с открытия' },
    })
    fireEvent.click(submit)

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      expect(requestOf(put?.[0] as RequestInfo | URL)).toContain(
        `/v1/admin/guests/${GUEST_ID}/tier`,
      )
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        tierId: 'friends',
        reason: 'Друг владельца, ходит с открытия',
      })
    })
  })

  it('менеджер статус видит, но не меняет', async () => {
    stubApi({
      [`/v1/admin/guests/${GUEST_ID}`]: () => json(GUEST_CARD),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    const dialog = await openCard()

    expect(within(dialog).getByText('Золото')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: t('tierForm.open') })).toBeNull()
  })
})

describe('Гости: фильтры и выгрузка', () => {
  const openGuests = async (): Promise<void> => {
    await fillAndSubmitLogin()
    fireEvent.click(await screen.findByRole('link', { name: t('nav.guests') }))
    await screen.findByRole('button', { name: 'Анна Ковалёва' })
  }

  it('ФИЛЬТРЫ УХОДЯТ НА СЕРВЕР И ЖИВУТ В АДРЕСЕ; СТАТУС ГОСТЯ — В ТАБЛИЦЕ', async () => {
    const fetchMock = stubApi({ '/v1/admin/guests': () => json(GUEST_ROWS) })
    render(<App />)

    await openGuests()

    expect(screen.getByRole('cell', { name: 'Золото' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('guests.filter.mode')), {
      target: { value: 'RESIDENT' },
    })
    fireEvent.change(screen.getByLabelText(t('guests.filter.sleeping')), {
      target: { value: '30' },
    })

    await waitFor(() => {
      expect(requested(fetchMock, 'mode=RESIDENT&sleeping=30')).toBe(true)
    })
    expect(window.location.search).toContain('mode=RESIDENT')

    // Статус и выгрузка — у владельца: менеджер фильтрует по остальному.
    expect(screen.queryByLabelText(t('guests.filter.tier'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('guests.export.open') })).toBeNull()
  })

  it('ВЛАДЕЛЕЦ ВЫГРУЖАЕТ ТО, ЧТО НА ЭКРАНЕ, — ТОЛЬКО С ПРИЧИНОЙ; ФАЙЛ СОХРАНЯЕТСЯ', async () => {
    const csv = `${String.fromCharCode(0xfeff)}Имя,Телефон\r\nАнна Ковалёва,'+66 •• •• 4821\r\n`
    const created = vi.fn(() => 'blob:guests')
    Object.defineProperty(URL, 'createObjectURL', {
      value: created,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const fetchMock = stubApi({
      '/v1/auth/staff/pin': () => json(OWNER_TOKENS),
      '/v1/admin/settings/program/suspicious': () => json(SUSPICIOUS_SETTINGS),
      '/v1/admin/settings/program/reviews': () => json(REVIEW_SETTINGS),
      '/v1/admin/settings/program/birthday': () => json(BIRTHDAY_SETTINGS),
      '/v1/admin/settings/program/referral': () => json(REFERRAL_SETTINGS),
      '/v1/admin/settings/program/staff-reward': () => json(STAFF_REWARD_SETTINGS),
      '/v1/admin/settings/program/tiers': () => json(TIER_SETTINGS),
      '/v1/admin/guests/export': () =>
        new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }),
      '/v1/admin/guests': () => json(GUEST_ROWS),
    })
    render(<App />)

    await openGuests()

    fireEvent.change(await screen.findByLabelText(t('guests.filter.tier')), {
      target: { value: 'gold' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('guests.export.open') }))

    const submit = screen.getByRole('button', { name: t('guests.export.submit') })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(t('guests.export.reason')), {
      target: { value: 'Рассылка гостям со статусом' },
    })
    fireEvent.click(submit)

    await waitFor(() => {
      expect(click).toHaveBeenCalled()
    })

    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestOf(input as RequestInfo | URL).includes('/v1/admin/guests/export') &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      reason: 'Рассылка гостям со статусом',
      filters: { tier: 'gold' },
      locale: 'ru',
    })
    expect(created).toHaveBeenCalled()
    expect(await screen.findByText(fill(t('guests.export.done'), { n: 1 }))).toBeInTheDocument()

    click.mockRestore()
  })
})
