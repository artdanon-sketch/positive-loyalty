import { useLayoutEffect } from 'react'

import { captureInvite } from '../shared/invite/pending-invite'
import { AppProviders } from './providers/app-providers'
import { AppRoutes } from './routes'

export function App() {
  // Приглашение из адреса — раньше маршрутов. Переадресация на вход срезает адрес
  // в эффекте дочернего компонента, а эффекты раскладки родителя успевают первыми.
  useLayoutEffect(() => {
    captureInvite()
  }, [])

  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  )
}
