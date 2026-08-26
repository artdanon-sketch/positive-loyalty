/**
 * @positive/ui — дизайн-система POSitive Loyalty.
 *
 * Токены подключаются отдельным импортом, минуя сборку TypeScript:
 *
 *   import '@positive/ui/tokens.css'
 *
 * Компонентов здесь пока нет — они появляются под конкретные экраны,
 * список запланированных см. docs/04_Дизайн-система.md, раздел 6.
 */

export {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  getCurrentTheme,
  getInitialTheme,
  getSystemTheme,
  isTheme,
  toggleTheme,
  type Theme,
} from './theme.js'
