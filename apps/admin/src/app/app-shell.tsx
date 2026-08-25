import type { ReactElement } from 'react'
import { Outlet } from 'react-router-dom'

import { useT } from '../shared/i18n'
import { ThemeToggle } from '../shared/ui/theme-toggle'

/**
 * Каркас бэк-офиса: шапка и область экрана.
 *
 * Левого меню на восемь пунктов (docs/03_Бэк-офис_экраны.md, раздел 1) здесь
 * намеренно нет: в задаче 1 существует ровно один экран, а меню из одного пункта —
 * это мебель, которую придётся переделывать вместе с ролями и правами.
 */
export function AppShell(): ReactElement {
  const t = useT()

  return (
    <div className="app-shell">
      <a className="app-shell__skip" href="#main">
        {t('app.skipToContent')}
      </a>

      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true" />
          <span className="app-header__name">{t('app.brand')}</span>
          <span className="app-header__section">{t('app.section')}</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="app-main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
