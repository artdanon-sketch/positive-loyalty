import type { ReactElement } from 'react'

import { useTheme } from '../../app/theme-context'
import { useT } from '../i18n'

/**
 * Переключатель темы. Состояние живёт в провайдере темы, запись в `data-theme`
 * и в localStorage — в `applyTheme` из `@positive/ui`.
 *
 * Смысл не передаётся одним цветом: у кнопки есть подпись и `aria-pressed`
 * (docs/04_Дизайн-система.md, раздел 8).
 */
export function ThemeToggle(): ReactElement {
  const { theme, toggleTheme } = useTheme()
  const t = useT()

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={t('theme.toggle.label')}
      aria-pressed={theme === 'light'}
      onClick={toggleTheme}
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {theme === 'dark' ? '☾' : '☀'}
      </span>
      <span className="theme-toggle__label">
        {theme === 'dark' ? t('theme.dark') : t('theme.light')}
      </span>
    </button>
  )
}
