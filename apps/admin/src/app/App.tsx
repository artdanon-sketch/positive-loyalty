import type { ReactElement } from 'react'
import { BrowserRouter } from 'react-router-dom'

import { Providers } from './providers'
import { AppRoutes } from './routes'

export function App(): ReactElement {
  return (
    <Providers>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  )
}
