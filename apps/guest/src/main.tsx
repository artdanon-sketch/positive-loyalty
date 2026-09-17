import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@positive/ui/tokens.css'
import './styles/global.css'
import { App } from './app/App'
import { registerServiceWorker } from './shared/install/service-worker'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('В index.html не найден элемент #root')
}

// Регистрация до первой отрисовки не нужна: поток заступает после загрузки.
registerServiceWorker()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
