import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useReferralSettings } from '../hooks'
import { ReferralForm } from './referral-form'

/**
 * Блок «Приглашения друзей» на экране настроек. docs/03, раздел 9 · docs/11, У6.
 *
 * Свои данные и своя кнопка сохранения: приглашения — отдельный вход на сервере,
 * и сохранение статусов не должно заодно переписывать награду за друзей.
 */
export function ReferralSettingsSection(): ReactElement {
  const t = useT()
  const settings = useReferralSettings()

  return (
    <section className="panel" aria-labelledby="referral-title">
      <h2 className="panel__title" id="referral-title">
        {t('referral.title')}
      </h2>
      <p className="field__hint">{t('referral.hint')}</p>

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
        <ReferralForm initial={settings.data} />
      )}
    </section>
  )
}
