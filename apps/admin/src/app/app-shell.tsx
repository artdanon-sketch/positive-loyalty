import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../shared/auth/auth-context'
import { isCashierApp } from '../shared/config/product'
import { useT } from '../shared/i18n'
import type { TranslationKey } from '../shared/i18n'
import { ThemeToggle } from '../shared/ui/theme-toggle'
import { GlobalSearch } from './global-search'
import { NavIcon } from './nav-icon'
import type { NavIconName } from './nav-icon'

/**
 * Каркас бэк-офиса: левое меню и область экрана. docs/03, раздел 1 · docs/11, У1.
 *
 * ЛЕВОЕ МЕНЮ С ИКОНКАМИ — как задумано в 03 и как сделано у UDS. Строка пунктов
 * в шапке на ноутбуке уже не помещалась, а на телефоне уезжала вбок. Слева пункты
 * стоят столбиком, текущий подсвечен, группы разделены чертой. На узком экране
 * меню выдвигается кнопкой и само закрывается после перехода — иначе оно
 * закрывало бы экран, ради которого человек нажал пункт.
 *
 * Пункты — ровно по числу существующих экранов. Остальные разделы из docs/11
 * добавляются вместе со своими экранами, а не заранее: меню из мёртвых ссылок
 * хуже короткого.
 *
 * НАБОР ПУНКТОВ ЗАВИСИТ ОТ РОЛИ. Скрытие здесь — вежливость, а не защита:
 * настоящий запрет стоит на API, и сотрудник без прав получит отказ даже по
 * прямой ссылке. Показывать пункты, которые ответят отказом, — значит учить
 * не доверять интерфейсу.
 *
 * У КАССИРА БОКОВОГО МЕНЮ НЕТ. Ему доступна одна касса, и колонка с единственным
 * пунктом отняла бы место у экрана, на котором он работает весь день.
 */

interface NavItem {
  readonly to: string
  readonly label: TranslationKey
  readonly icon: NavIconName
  readonly end?: boolean
  /** «Команда» и «Настройки»: в матрице прав docs/05 это галочки владельца. */
  readonly ownerOnly?: boolean
}

const NAV_GROUPS: ReadonlyArray<readonly NavItem[]> = [
  [
    { to: '/', label: 'nav.overview', icon: 'overview', end: true },
    // Отчёты — сразу под обзором: у владельца их спрашивают чаще всего (docs/11, раздел 2).
    { to: '/reports', label: 'nav.reports', icon: 'reports' },
    { to: '/operations', label: 'nav.operations', icon: 'operations' },
    { to: '/guests', label: 'nav.guests', icon: 'guests' },
    { to: '/offers', label: 'nav.offers', icon: 'offers' },
    // Смотреть партнёрства может и менеджер; договариваться — только владелец,
    // и кнопок у менеджера на экранах нет.
    { to: '/partners', label: 'nav.partners', icon: 'partners' },
  ],
  [
    { to: '/team', label: 'nav.team', icon: 'team', ownerOnly: true },
    { to: '/pos', label: 'nav.pos', icon: 'pos' },
  ],
  [
    { to: '/sale-kinds', label: 'nav.saleKinds', icon: 'saleKinds' },
    { to: '/settings', label: 'nav.settings', icon: 'settings', ownerOnly: true },
  ],
]

const TILL_ITEM: NavItem = { to: '/pos', label: 'nav.pos', icon: 'pos' }

const ROLE_LABELS: Readonly<Record<string, TranslationKey>> = {
  OWNER: 'role.owner',
  MANAGER: 'role.manager',
  CASHIER: 'role.cashier',
}

export function AppShell(): ReactElement {
  const t = useT()
  const auth = useAuth()
  const subject = auth.session?.subject ?? null
  const [menuOpen, setMenuOpen] = useState(false)

  const roleKey = subject === null ? null : (ROLE_LABELS[subject.role] ?? null)
  // Либо человек кассир, либо это приложение кассира — в обоих случаях
  // бэк-офиса на экране нет.
  const isCashier = subject?.role === 'CASHIER' || isCashierApp()
  const isOwner = subject?.role === 'OWNER'

  // Открытое меню закрывается клавишей Esc — как любое выдвижное окно.
  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const closeMenu = (): void => {
    setMenuOpen(false)
  }

  const navClass = ({ isActive }: { isActive: boolean }): string =>
    isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link'

  const renderLink = (item: NavItem): ReactElement => (
    <NavLink
      key={item.to}
      className={navClass}
      to={item.to}
      end={item.end ?? false}
      onClick={closeMenu}
    >
      <NavIcon name={item.icon} />
      <span>{t(item.label)}</span>
    </NavLink>
  )

  const brand = (
    <div className="app-header__brand">
      <span className="app-header__mark" aria-hidden="true" />
      <span className="app-header__name">{t('app.brand')}</span>
      <span className="app-header__section">{t('app.section')}</span>
    </div>
  )

  const user =
    subject === null ? null : (
      <span className="app-user">
        <span className="app-user__name">{subject.displayName}</span>
        {roleKey !== null ? <span className="app-user__role">{t(roleKey)}</span> : null}
      </span>
    )

  const logout = (
    <button className="button" type="button" onClick={auth.logout}>
      {t('auth.logout')}
    </button>
  )

  if (isCashier) {
    return (
      <div className="app-shell app-shell--till">
        <a className="app-shell__skip" href="#main">
          {t('app.skipToContent')}
        </a>

        <header className="app-topbar">
          {brand}
          <nav className="app-nav app-nav--inline" aria-label={t('nav.label')}>
            {renderLink(TILL_ITEM)}
          </nav>
          <div className="app-topbar__side">
            {user}
            <ThemeToggle />
            {logout}
          </div>
        </header>

        <main className="app-main" id="main">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className={menuOpen ? 'app-shell app-shell--menu-open' : 'app-shell'}>
      <a className="app-shell__skip" href="#main">
        {t('app.skipToContent')}
      </a>

      <aside className="app-sidebar" id="app-sidebar">
        {brand}

        <nav className="app-nav" aria-label={t('nav.label')}>
          {NAV_GROUPS.map((group, index) => (
            <div className="app-nav__group" key={index}>
              {group.filter((item) => item.ownerOnly !== true || isOwner).map(renderLink)}
            </div>
          ))}
        </nav>

        <div className="app-sidebar__foot">
          {user}
          <div className="app-sidebar__actions">
            <ThemeToggle />
            {logout}
          </div>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="app-shell__scrim"
          type="button"
          aria-label={t('nav.close')}
          onClick={closeMenu}
        />
      ) : null}

      <div className="app-body">
        <header className="app-topbar">
          <button
            className="button app-topbar__menu"
            type="button"
            aria-controls="app-sidebar"
            aria-expanded={menuOpen}
            aria-label={t('nav.menu')}
            onClick={() => {
              setMenuOpen((open) => !open)
            }}
          >
            <NavIcon name="menu" />
          </button>
          <GlobalSearch />
        </header>

        <main className="app-main" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
