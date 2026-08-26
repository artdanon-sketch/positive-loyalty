import type { ReactElement, ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { GuestsPage } from '../pages/guests/Page'
import { LoginPage } from '../pages/login/Page'
import { OperationsPage } from '../pages/operations/Page'
import { OverviewPage } from '../pages/overview/Page'
import { useAuth } from '../shared/auth/auth-context'
import { useT } from '../shared/i18n'
import { AppShell } from './app-shell'

/**
 * Пока восстанавливается сессия — заставка, а не мигание экраном входа
 * перед человеком, у которого сессия жива.
 */
function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const auth = useAuth()
  const t = useT()

  if (auth.status === 'restoring') {
    return (
      <div className="splash" role="status">
        <span className="app-header__mark" aria-hidden="true" />
        <p className="state__hint">{t('auth.restoring')}</p>
      </div>
    )
  }

  if (auth.session === null) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

/**
 * Маршруты бэк-офиса: вход и три экрана Среза 1 — обзор, операции, гости
 * (docs/03_Бэк-офис_экраны.md, раздел 1; остальные пять появятся со своими срезами).
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="operations" element={<OperationsPage />} />
        <Route path="guests" element={<GuestsPage />} />
        {/* Неизвестный адрес возвращает на «Обзор», а не в пустоту. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
