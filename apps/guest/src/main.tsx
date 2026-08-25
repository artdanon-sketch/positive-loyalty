import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@positive/ui/tokens.css'
import './styles/global.css'
import { App } from './app/App'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('В index.html не найден элемент #root')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
