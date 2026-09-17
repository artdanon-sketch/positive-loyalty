import type { ReactElement } from 'react'

import { useInstallPrompt } from '../../../shared/install/use-install-prompt'
import { useT } from '../../../shared/i18n/i18n-context'

/**
 * «Поставить карту на телефон» на карте гостя. docs/03, раздел 10.
 *
 * ВНИЗУ, А НЕ СВЕРХУ. Гость открыл карту ради кода кассиру; предложение
 * установить приложение поверх кода — это очередь у стойки.
 *
 * НА iPHONE — СЛОВАМИ. Там окна установки не существует, и единственное честное,
 * что мы можем, — назвать две кнопки, которые надо нажать. Врать про «нажмите
 * установить» нельзя: такой кнопки у него нет.
 *
 * ПРЕДЛАГАТЬ НЕЧЕГО — БЛОКА НЕТ: карта уже на экране, открыта в Telegram
 * или браузер установку не умеет.
 */
export function InstallCard(): ReactElement | null {
  const t = useT()
  const state = useInstallPrompt()

  if (state.kind === 'hidden') {
    return null
  }

  return (
    <section className="install" aria-labelledby="install-title">
      <h2 className="card__sectionTitle" id="install-title">
        {t('install.title')}
      </h2>
      <p className="install__hint">{t('install.why')}</p>

      {state.kind === 'ready' ? (
        <button className="install__button" type="button" onClick={state.install}>
          {t('install.action')}
        </button>
      ) : (
        <p className="install__steps">{t('install.ios')}</p>
      )}
    </section>
  )
}
