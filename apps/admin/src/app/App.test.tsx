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
