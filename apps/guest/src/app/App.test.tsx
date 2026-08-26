import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY } from '@positive/ui'

import { fetchCard } from '../pages/card/card-api'
import { t } from '../shared/i18n/dictionaries'
import { App } from './App'

// Состояния экрана переключает состояние запроса, а не адресная строка: подменяем
// queryFn — единственный их источник. Заодно это гарантия, что демо-флага в бандле нет:
// подсунуть экран ошибки снаружи больше нечем.
vi.mock('../pages/card/card-api', () => ({ fetchCard: vi.fn() }))

const fetchCardMock = vi.mocked(fetchCard)

// Язык по умолчанию русский, localStorage пуст — ожидания берём из того же словаря,
// который выберет и приложение.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  window.history.replaceState({}, '', '/')
  fetchCardMock.mockResolvedValue({ hasPoints: false })
})

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('показывает состояние загрузки, пока карта не пришла', async () => {
    // Запрос, который не завершится: ровно то, что видит гость на слабом 4G.
    fetchCardMock.mockReturnValue(new Promise<never>(() => {}))

    render(<App />)

    expect(await screen.findByText(t('card.loading.label'))).toBeVisible()
    expect(screen.queryByText(t('card.empty.title'))).not.toBeInTheDocument()
  })

  it('рисует экран карты в пустом состоянии', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: t('card.title') })).toBeVisible()
    expect(await screen.findByText(t('card.empty.title'))).toBeVisible()
    expect(screen.getByText(t('card.empty.text'))).toBeVisible()
  })

  it('показывает состояние ошибки, когда запрос упал', async () => {
    fetchCardMock.mockRejectedValue(new Error('сеть недоступна'))

    render(<App />)

    // retry: 1 в QueryProvider — до ошибки проходит вторая попытка с паузой около секунды.
    const alert = await screen.findByRole('alert', undefined, { timeout: 5000 })

    expect(alert).toHaveTextContent(t('card.error.title'))
    expect(screen.getByRole('button', { name: t('card.error.retry') })).toBeVisible()
  })

  it('«Попробовать снова» перезапрашивает карту, а не чистит адрес', async () => {
    fetchCardMock.mockRejectedValue(new Error('сеть недоступна'))

    render(<App />)

    await screen.findByRole('alert', undefined, { timeout: 5000 })

    fetchCardMock.mockResolvedValue({ hasPoints: false })
    fireEvent.click(screen.getByRole('button', { name: t('card.error.retry') }))

    expect(
      await screen.findByText(t('card.empty.title'), undefined, { timeout: 5000 }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('переключает тему на <html> и запоминает выбор', async () => {
    render(<App />)

    await screen.findByText(t('card.empty.title'))

    // matchMedia в jsdom нет, системного предпочтения не видно — стартуем с тёмной темы.
    expect(document.documentElement.dataset.theme).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: t('app.theme.toLight') }))

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: t('app.theme.toDark') }))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
