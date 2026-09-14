import type { ReactElement } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../shared/auth/auth-context'
import { isCashierApp } from '../shared/config/product'
import { useT } from '../shared/i18n'
import type { TranslationKey } from '../shared/i18n'
import { ThemeToggle } from '../shared/ui/theme-toggle'

/**
 * Каркас бэк-офиса: шапка с навигацией и область экрана.
 *
 * Пункты — ровно по числу существующих экранов Среза 1. Остальные из docs/03,
 * раздел 1 добавляются вместе со своими экранами, а не заранее: меню из мёртвых
 * ссылок хуже короткого.
 *
 * НАБОР ПУНКТОВ ЗАВИСИТ ОТ РОЛИ. Кассиру видна только касса: «финансы
 * и настройки скрыты не только в интерфейсе, но и на уровне API» (docs/03,
 * раздел 10). Скрытие здесь — вежливость, а не защита: настоящий запрет стоит
 * на `AdminController`, и кассир получит 404 даже по прямой ссылке. Показывать
 * ему пункты, которые ответят отказом, — значит учить не доверять интерфейсу.
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
  // Либо человек кассир, либо это приложение кассира — в обоих случаях
  // бэк-офиса на экране нет.
  const isCashier = subject?.role === 'CASHIER' || isCashierApp()

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
          {isCashier ? null : (
            <>
              <NavLink className={navClass} to="/" end>
                {t('nav.overview')}
              </NavLink>
              <NavLink className={navClass} to="/operations">
                {t('nav.operations')}
              </NavLink>
              <NavLink className={navClass} to="/guests">
                {t('nav.guests')}
              </NavLink>
              <NavLink className={navClass} to="/sale-kinds">
                {t('nav.saleKinds')}
              </NavLink>
              {/* Только владелец: «Управлять сотрудниками» в матрице прав
                  docs/05 — одна галочка, и она у него. Менеджеру API ответит
                  отказом, и нерабочий пункт в меню только сбивал бы с толку. */}
              {subject?.role === 'OWNER' ? (
                <NavLink className={navClass} to="/team">
                  {t('nav.team')}
                </NavLink>
              ) : null}
            </>
          )}
          {/* Касса доступна всем: у владельца в мобильной версии это
              центральная кнопка сканера (docs/03, раздел 10). */}
          <NavLink className={navClass} to="/pos">
            {t('nav.pos')}
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
