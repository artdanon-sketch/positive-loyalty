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

const stubApi = (
  overrides: Partial<Record<string, (init?: RequestInit) => Response>> = {},
): ReturnType<typeof vi.fn> => {
  const handler = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestOf(input)
    const path = url.replace(/^https?:\/\/[^/]+/, '')

    for (const [prefix, respond] of Object.entries(overrides)) {
      if (path.startsWith(prefix) && respond !== undefined) {
        return Promise.resolve(respond(init))
      }
    }

    if (path.startsWith('/v1/auth/staff/pin')) {
      return Promise.resolve(json(TOKENS_RESPONSE))
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
