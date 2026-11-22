import { useState } from 'react'

import { useT } from '../i18n/i18n-context'
import { applySkin, getInitialSkin, SKINS, type Skin } from './skin'
import { useTheme } from './theme-context'

/**
 * Оформление: тема (луна / солнце) и скин (два цветных кружка).
 *
 * Значок, а не слово: серая плашка «Светлая тема» на экране входа спорила с
 * заголовком, а стилей у неё не было вовсе — они жили в `card.css`, который
 * никто не подключал. Подпись осталась в aria-label и title: она называет
 * результат нажатия, а не текущее состояние.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const t = useT()
  const label = theme === 'dark' ? t('app.theme.toLight') : t('app.theme.toDark')

  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
        </svg>
      )}
    </button>
  )
}

const SKIN_LABEL = { violet: 'app.skin.violet', orange: 'app.skin.orange' } as const

export function SkinPicker() {
  const t = useT()
  const [skin, setSkin] = useState<Skin>(getInitialSkin)

  return (
    <div className="skin-picker" role="radiogroup" aria-label={t('app.skin.title')}>
      {SKINS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={skin === value}
          aria-label={t(SKIN_LABEL[value])}
          title={t(SKIN_LABEL[value])}
          className={`skin-picker__dot skin-picker__dot--${value}`}
          onClick={() => {
            setSkin(applySkin(value))
          }}
        />
      ))}
    </div>
  )
}

/** Тема и скин рядом — так их и ставят на экраны. */
export function LookControls() {
  return (
    <div className="look">
      <SkinPicker />
      <ThemeToggle />
    </div>
  )
}
