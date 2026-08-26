import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'

/**
 * Первый день: вместо плиток — онбординг-чеклист
 * (docs/03_Бэк-офис_экраны.md, раздел 2, «Состояния»).
 * Пустое состояние объясняет, что сделать, а не констатирует пустоту.
 */
export function EmptyState(): ReactElement {
  const t = useT()

  const steps: readonly string[] = [
    t('overview.empty.step.qr'),
    t('overview.empty.step.staff'),
    t('overview.empty.step.guest'),
  ]

  return (
    <div className="state state--empty">
      <h2 className="state__title">{t('overview.empty.title')}</h2>
      <p className="state__hint">{t('overview.empty.hint')}</p>
      <ol className="checklist">
        {steps.map((step, index) => (
          <li className="checklist__item" key={step}>
            <span className="checklist__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="checklist__text">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
