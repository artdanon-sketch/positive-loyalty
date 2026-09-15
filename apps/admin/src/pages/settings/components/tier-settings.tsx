import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useTierSettings } from '../hooks'
import { TierLadderForm } from './tier-ladder-form'

/**
 * Блок «Статусы гостей» на экране настроек. docs/03, раздел 9 · docs/11, У3.
 *
 * Свои данные и своя кнопка сохранения: лестница — отдельный вход на сервере,
 * и сохранение процента начисления не должно заодно переписывать статусы.
 */
export function TierSettingsSection(): ReactElement {
  const t = useT()
  const settings = useTierSettings()

  return (
    <section className="panel" aria-labelledby="tiers-title">
      <h2 className="panel__title" id="tiers-title">
        {t('tiers.title')}
      </h2>
      <p className="field__hint">{t('tiers.hint')}</p>

      {settings.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : settings.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{settings.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void settings.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <TierLadderForm initial={settings.data} />
      )}
    </section>
  )
}
