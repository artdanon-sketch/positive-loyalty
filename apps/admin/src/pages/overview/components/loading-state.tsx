import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'

/** Скелетоны вместо трёх плиток, пока сводка едет. */
export function LoadingState(): ReactElement {
  const t = useT()

  return (
    <div className="state state--loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('overview.loading.label')}</span>
      <div className="skeleton-tiles" aria-hidden="true">
        <span className="skeleton skeleton--tile" />
        <span className="skeleton skeleton--tile" />
        <span className="skeleton skeleton--tile" />
      </div>
      <p className="state__hint">{t('overview.loading.hint')}</p>
    </div>
  )
}
