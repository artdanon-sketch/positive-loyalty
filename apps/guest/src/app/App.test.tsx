import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dictionaries } from '../shared/i18n/dictionaries'
import { App } from './App'

/**
 * Гостевое приложение: вход по коду → карта с кошельком и QR.
 *
 * Сервер подменяется на уровне fetch: компонентные тесты проверяют экран,
 * а контракт API исчерпывающе проверяют интеграционные тесты API.
 */

const t = (key: keyof typeof dictionaries.ru): string => dictionaries.ru[key]

const OTP_RESPONSE = {
  requestId: '11111111-1111-4111-8111-111111111111',
  expiresIn: 300,
  resendAfter: 60,
  devCode: '123456',
}

const AUTH_RESPONSE = {
  accessToken: 'guest-access-token',
  refreshToken: 'guest-refresh-token',
  expiresIn: 900,
  guest: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: null,
    mode: 'TOURIST',
    locale: 'ru',
  },
  isNew: true,
}

// Два заведения с РАЗНЫМИ суммами: итог кошелька не должен совпадать
// ни с одной строкой, иначе поиск по тексту находит несколько элементов
// и тест падает на собственных данных, а не на коде.
const WALLET_RESPONSE = {
  totalPoints: 42_500,
  memberships: [
    {
      tenantId: '33333333-3333-4333-8333-333333333333',
      brandName: 'Kata Beach Kitchen',
      points: 30_175,
      visitsTotal: 4,
      lastVisitAt: '2026-08-26T10:00:00.000Z',
      isControlGroup: false,
    },
    {
      tenantId: '44444444-4444-4444-8444-444444444444',
      brandName: 'Sabai Thai Massage',
      points: 12_325,
      visitsTotal: 0,
      lastVisitAt: null,
      isControlGroup: true,
    },
  ],
}

const QR_RESPONSE = { token: 'guest-qr-token', expiresIn: 300 }

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const pathOf = (input: RequestInfo | URL): string => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.replace(/^https?:\/\/[^/]+/, '')
}

const stubApi = (overrides: Record<string, () => Response> = {}): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const path = pathOf(input)

      for (const [prefix, respond] of Object.entries(overrides)) {
        if (path.startsWith(prefix)) {
          return Promise.resolve(respond())
        }
      }

      if (path.startsWith('/v1/auth/otp/request')) return Promise.resolve(json(OTP_RESPONSE))
      if (path.startsWith('/v1/auth/otp/verify')) return Promise.resolve(json(AUTH_RESPONSE))
      if (path.startsWith('/v1/guest/wallet')) return Promise.resolve(json(WALLET_RESPONSE))
      if (path.startsWith('/v1/guest/qr-token')) return Promise.resolve(json(QR_RESPONSE))

      return Promise.resolve(
        json({ error: { code: 'NOT_FOUND', message: `нет обработчика для ${path}` } }, 404),
      )
    }),
  )
}

const signIn = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText(t('signin.phone')), {
    target: { value: '+66812345678' },
  })
  fireEvent.click(screen.getByRole('button', { name: t('signin.getCode') }))

  fireEvent.change(await screen.findByLabelText(t('signin.code')), {
    target: { value: OTP_RESPONSE.devCode },
  })
  fireEvent.click(screen.getByRole('button', { name: t('signin.submit') }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Гостевое приложение', () => {
  it('без сессии показывает экран входа', async () => {
    stubApi()
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: t('signin.title') }),
    ).toBeInTheDocument()
  })

  it('вход по коду открывает карту с баллами и QR', async () => {
    stubApi()
    render(<App />)

    await signIn()

    // Баллы показаны в батах, хотя приходят целыми в сатангах.
    expect(await screen.findByText('425,00 ฿')).toBeInTheDocument()
    expect(screen.getByText('301,75 ฿')).toBeInTheDocument()
    expect(screen.getByText('Kata Beach Kitchen')).toBeInTheDocument()
    // Контрольная группа помечена — гость видит, почему баллов не прибавляется.
    expect(screen.getByText(t('card.venues.control'))).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: t('card.qr.alt') })).toBeInTheDocument()
  })

  it('код подсказывается на экране, пока нет SMS-провайдера', async () => {
    stubApi()
    render(<App />)

    fireEvent.change(await screen.findByLabelText(t('signin.phone')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('signin.getCode') }))

    expect(await screen.findByText(OTP_RESPONSE.devCode)).toBeInTheDocument()
  })

  it('отказ сервера показывает его сообщение, не выдумывая своего', async () => {
    stubApi({
      '/v1/auth/otp/verify': () =>
        json({ error: { code: 'UNAUTHORIZED', message: 'Не удалось войти' } }, 401),
    })
    render(<App />)

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось войти')
    expect(screen.getByRole('heading', { level: 1, name: t('signin.title') })).toBeInTheDocument()
  })

  it('ошибка кошелька показывает текст сервера и кнопку повтора', async () => {
    stubApi({
      '/v1/guest/wallet': () =>
        json({ error: { code: 'UNKNOWN', message: 'Кошелёк временно недоступен' } }, 500),
    })
    render(<App />)

    await signIn()

    // У запросов включён retry: 1 (мобильная сеть на острове рвётся), поэтому
    // ошибка доезжает до экрана после повторной попытки — ждём дольше обычного.
    expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(
      'Кошелёк временно недоступен',
    )
    expect(screen.getByRole('button', { name: t('card.error.retry') })).toBeInTheDocument()
  })

  it('переключает тему на противоположную', async () => {
    stubApi()
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: t('signin.title') })
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBeNull()
    })

    const before = document.documentElement.getAttribute('data-theme')
    // Подпись кнопки зависит от текущей темы: ищем ту, что предлагает
    // противоположную — она на экране ровно одна.
    const toggle =
      screen.queryByRole('button', { name: t('app.theme.toLight') }) ??
      screen.getByRole('button', { name: t('app.theme.toDark') })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBe(before)
    })
  })
})
