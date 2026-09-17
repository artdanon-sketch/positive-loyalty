import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useTenantProfile } from '../profile-hooks'
import { ProfileForm } from './profile-form'

/**
 * Блок «Заведение» на экране настроек. docs/03, раздел 9.
 *
 * СТОИТ ПЕРВЫМ: это паспорт заведения, а не тонкая настройка. Владелец, впервые
 * открывший настройки, должен увидеть своё название, а не процент начисления.
 */
export function ProfileSettingsSection(): ReactElement {
  const t = useT()
  const profile = useTenantProfile()

  return (
    <section className="panel" aria-labelledby="profile-title">
      <h2 className="panel__title" id="profile-title">
        {t('profile.title')}
      </h2>
      <p className="field__hint">{t('profile.hint')}</p>

      {profile.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : profile.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{profile.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void profile.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <ProfileForm initial={profile.data} />
      )}
    </section>
  )
}
