import type { ReactElement, ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Page as CardPage } from '../pages/card/Page'
import { Page as SignInPage } from '../pages/signin/Page'
import { useSession } from '../shared/session/session-context'
import { useT } from '../shared/i18n/i18n-context'

/**
 * Пока восстанавливается сессия — заставка, а не мигание экраном входа
 * перед гостем, у которого карта уже открыта.
 */
function RequireGuest({ children }: { children: ReactNode }): ReactElement {
  const session = useSession()
  const t = useT()

  if (session.status === 'restoring') {
    return (
      <div className="splash" role="status">
        <span className="card__mark" aria-hidden="true" />
        <p className="card__stateHint">{t('card.restoring')}</p>
      </div>
    )
  }

  if (session.session === null) {
    return <Navigate to="/signin" replace />
  }

  return <>{children}</>
}

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route
        path="/"
        element={
          <RequireGuest>
            <CardPage />
          </RequireGuest>
        }
      />
      {/* Неизвестный адрес возвращаем на карту: у гостя в приложении один экран. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
