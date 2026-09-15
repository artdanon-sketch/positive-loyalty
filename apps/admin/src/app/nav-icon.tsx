import type { ReactElement } from 'react'

/**
 * Иконки левого меню. Свои, в коде, без библиотеки иконок: девять контуров
 * не стоят зависимости в бандле (CLAUDE.md, «что делать нельзя»).
 *
 * Иконка всегда рядом с подписью и для чтения с экрана скрыта: название пункта
 * — это подпись, а не картинка. Цвет — от текста, поэтому тема и подсветка
 * текущего раздела работают без отдельных правил.
 */

export type NavIconName =
  | 'overview'
  | 'operations'
  | 'guests'
  | 'offers'
  | 'partners'
  | 'team'
  | 'pos'
  | 'saleKinds'
  | 'settings'
  | 'menu'

const PATHS: Readonly<Record<NavIconName, string>> = {
  overview: 'M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  operations: 'M7 3.5h10a1 1 0 0 1 1 1V20l-3-2-3 2-3-2-3 2V4.5a1 1 0 0 1 1-1ZM9 8.5h6M9 12.5h6',
  guests:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.4 3.1-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.3 3.3 0 0 1 0 6.4M17.8 14.6c2 .7 3.3 2.5 3.7 5.4',
  offers:
    'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.8 7.8a1 1 0 0 1-1.4 0ZM8 8h.01',
  partners:
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  team: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 17c.6-1.7 2.1-2.7 4-2.7s3.4 1 4 2.7',
  pos: 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h2.5v2.5H14ZM17.5 17.5H20V20h-2.5ZM14 19h1.5M19 14h1',
  saleKinds: 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z',
  settings: 'M4 7h9M17 7h3M4 17h4M12 17h8M15 5v4M10 15v4',
  menu: 'M4 7h16M4 12h16M4 17h16',
}

export function NavIcon({ name }: { name: NavIconName }): ReactElement {
  return (
    <svg
      className="app-nav__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
