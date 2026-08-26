import type { ReactElement } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../shared/auth/auth-context'
import { useT } from '../shared/i18n'
import type { TranslationKey } from '../shared/i18n'
import { ThemeToggle } from '../shared/ui/theme-toggle'

/**
 * Каркас бэк-офиса: шапка с навигацией и область экрана.
 *
 * Пунктов три — ровно по числу существующих экранов Среза 1. Остальные пять
 * из docs/03, раздел 1 добавляются вместе со своими экранами, а не заранее:
 * меню из мёртвых ссылок хуже короткого.
 */

const ROLE_LABELS: Readonly<Record<string, TranslationKey>> = {
  OWNER: 'role.owner',
  MANAGER: 'role.manager',
  CASHIER: 'role.cashier',
}

export function AppShell(): ReactElement {
  const t = useT()
  const auth = useAuth()
  const subject = auth.session?.subject ?? null

  const navClass = ({ isActive }: { isActive: boolean }): string =>
    isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link'

  const roleKey = subject === null ? null : (ROLE_LABELS[subject.role] ?? null)

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

        <nav className="app-nav" aria-label={t('nav.label')}>
          <NavLink className={navClass} to="/" end>
            {t('nav.overview')}
          </NavLink>
          <NavLink className={navClass} to="/operations">
            {t('nav.operations')}
          </NavLink>
          <NavLink className={navClass} to="/guests">
            {t('nav.guests')}
          </NavLink>
        </nav>

        <div className="app-header__side">
          {subject !== null ? (
            <span className="app-user">
              <span className="app-user__name">{subject.displayName}</span>
              {roleKey !== null ? <span className="app-user__role">{t(roleKey)}</span> : null}
            </span>
          ) : null}
          <ThemeToggle />
          <button className="button" type="button" onClick={auth.logout}>
            {t('auth.logout')}
          </button>
        </div>
      </header>

      <main className="app-main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
