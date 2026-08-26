import { AppProviders } from './providers/app-providers'
import { AppRoutes } from './routes'

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  )
}
