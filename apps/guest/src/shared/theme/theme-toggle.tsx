import { useT } from '../i18n/i18n-context'
import { useTheme } from './theme-context'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const t = useT()

  // Подпись называет результат нажатия, а не текущее состояние: так кнопка читается
  // и глазами, и скринридером.
  const label = theme === 'dark' ? t('app.theme.toLight') : t('app.theme.toDark')

  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme}>
      {label}
    </button>
  )
}
