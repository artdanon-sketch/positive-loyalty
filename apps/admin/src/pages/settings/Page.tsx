import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n'
import { BirthdaySettingsSection } from './components/birthday-settings'
import { ChannelSettingsSection } from './components/channel-settings'
import { ReferralSettingsSection } from './components/referral-settings'
import { SettingsForm } from './components/settings-form'
import { TagSettingsSection } from './components/tag-settings'
import { TierSettingsSection } from './components/tier-settings'
import { useProgramSettings } from './hooks'

/**
 * Экран «Настройки программы»: сколько гость получает и как тратит баллы.
 *
 * ТОЛЬКО ТО, ЧТО КАССА УЖЕ СОБЛЮДАЕТ. В конфигурации программы описаны ещё
 * режим «скидка» и срок жизни баллов — но касса их не применяет. Статусы гостей,
 * приветственные баллы и награды за друзей касса соблюдает: они — отдельными
 * блоками со своими кнопками сохранения. Переключатель, который ничего не делает,
 * хуже отсутствующего: владелец включит «сгорание через год» и будет уверен,
 * что баллы сгорают. Эти настройки появятся на экране вместе со своими механиками.
 *
 * Форма — отдельным компонентом, который получает загруженные значения как
 * начальные. Так её состояние заводится один раз из данных, без эффекта,
 * переписывающего поля при каждом ответе сервера поверх того, что владелец
 * успел набрать.
 */
export function SettingsPage(): ReactElement {
  const t = useT()
  const settings = useProgramSettings()

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('settings.title')}</h1>
        <p className="page__subtitle">{t('settings.subtitle')}</p>
      </header>

      {settings.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : settings.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{settings.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void settings.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <SettingsForm initial={settings.data} />
          <TierSettingsSection />
          <ReferralSettingsSection />
          <BirthdaySettingsSection />
          <TagSettingsSection />
          <ChannelSettingsSection />
        </>
      )}
    </section>
  )
}
