import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme, getInitialTheme } from '@positive/ui'

import '@positive/ui/tokens.css'
import './styles.css'

import { App } from './app/App'
import { getInitialLocale } from './shared/i18n'

// Тема ставится до первого рендера: иначе первый кадр приезжает в тёмной теме,
// а затем моргает в светлую. Второй аргумент `false` — не запоминать: иначе
// предпочтение системы запишется в localStorage как осознанный выбор и тема
// перестанет следовать за настройками устройства.
// Тот же приём для языка — чтобы `lang` был честным с самого начала.
applyTheme(getInitialTheme(), false)
document.documentElement.setAttribute('lang', getInitialLocale())

const container = document.getElementById('root')

if (container === null) {
  throw new Error('Не найден элемент #root — проверьте index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
