import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useBirthdaySettings } from '../hooks'
import { BirthdayForm } from './birthday-form'

/**
 * Блок «Подарок ко дню рождения» на экране настроек. docs/03, раздел 9 · docs/11, У9.
 *
 * Свои данные и своя кнопка сохранения: подарок — отдельный вход на сервере,
 * и сохранение статусов или приглашений его не переписывает.
 */
export function BirthdaySettingsSection(): ReactElement {
  const t = useT()
  const settings = useBirthdaySettings()

  return (
    <section className="panel" aria-labelledby="birthday-title">
      <h2 className="panel__title" id="birthday-title">
        {t('birthday.title')}
      </h2>
      <p className="field__hint">{t('birthday.hint')}</p>

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
        <BirthdayForm initial={settings.data} />
      )}
    </section>
  )
}
