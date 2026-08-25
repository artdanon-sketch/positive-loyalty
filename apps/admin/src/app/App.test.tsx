import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { t } from '../shared/i18n'
import { App } from './App'

describe('App', () => {
  it('открывается на экране «Обзор»', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: t('overview.title') })).toBeInTheDocument()
  })

  it('показывает пустое состояние с чеклистом, пока данных нет', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 2, name: t('overview.empty.title') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('overview.empty.step.qr'))).toBeInTheDocument()
  })

  it('переключает тему на противоположную', async () => {
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBeNull()
    })
    const before = document.documentElement.getAttribute('data-theme')
    expect(before === 'dark' || before === 'light').toBe(true)

    fireEvent.click(screen.getByRole('button', { name: t('theme.toggle.label') }))

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe(
        before === 'dark' ? 'light' : 'dark',
      )
    })
  })

  // Негативный сценарий: без SPA-фолбэка и без catch-all маршрута
  // прямой заход на несуществующий адрес показал бы пустой экран.
  it('неизвестный адрес возвращает на «Обзор», а не в пустоту', () => {
    window.history.pushState({}, '', '/такого-экрана-нет')

    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: t('overview.title') })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })
})
