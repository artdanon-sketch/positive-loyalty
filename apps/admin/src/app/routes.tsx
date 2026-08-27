import type { ReactElement, ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { GuestsPage } from '../pages/guests/Page'
import { LoginPage } from '../pages/login/Page'
import { OperationsPage } from '../pages/operations/Page'
import { OverviewPage } from '../pages/overview/Page'
import { PosPage } from '../pages/pos/Page'
import { isCashierApp } from '../shared/config/product'
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
 * Домашний экран роли.
 *
 * Кассир открывает приложение, чтобы пробить чек, а не посмотреть отчёт:
 * «Обзор» ему закрыт на API и ответил бы отказом. Отправлять человека
 * на экран, который для него не работает, — худший первый кадр смены.
 */
function RoleHome(): ReactElement {
  const auth = useAuth()

  // В приложении кассира отчёты не показываются никому: иконка с названием
  // «Касса» обещает кассу, и открывать под ней выручку — сломанное обещание.
  if (isCashierApp()) {
    return <PosPage />
  }

  return auth.session?.subject.role === 'CASHIER' ? <PosPage /> : <OverviewPage />
}

/**
 * Маршруты бэк-офиса: вход, три экрана Среза 1 и касса
 * (docs/03_Бэк-офис_экраны.md, разделы 1 и 10).
 *
 * Экраны менеджера отдельными маршрутами не закрываются: запрет живёт
 * на `AdminController`, и кассир по прямой ссылке увидит отказ сервера,
 * а не подделанную клиентом «страницу без прав». Дублировать матрицу прав
 * во фронте — значит завести вторую правду о доступе.
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
        <Route index element={<RoleHome />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="operations" element={<OperationsPage />} />
        <Route path="guests" element={<GuestsPage />} />
        {/* Неизвестный адрес возвращает на домашний экран роли, а не в пустоту. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
