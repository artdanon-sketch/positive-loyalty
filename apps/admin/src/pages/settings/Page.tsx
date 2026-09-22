import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { BirthdaySettingsSection } from './components/birthday-settings'
import { ChannelSettingsSection } from './components/channel-settings'
import { BotSettingsSection } from './components/bot-settings'
import { IntegrationSettingsSection } from './components/integration-settings'
import { ProfileSettingsSection } from './components/profile-settings'
import { ReferralSettingsSection } from './components/referral-settings'
import { StaffRewardSettingsSection } from './components/staff-reward-settings'
import { ReviewRepliesSection } from './components/review-replies-settings'
import { SecuritySettingsSection } from './components/security-settings'
import { SettingsForm } from './components/settings-form'
import { TagSettingsSection } from './components/tag-settings'
import { TierSettingsSection } from './components/tier-settings'
import { useProgramSettings } from './hooks'

/**
 * Экран «Настройки программы»: сколько гость получает и как тратит баллы.
 *
 * ВКЛАДКАМИ, А НЕ ОДНИМ СВИТКОМ. Разделов двенадцать: проценты, статусы,
 * рефералы, мотивация кассира, день рождения, автоответы, безопасность, теги,
 * источники, бот, связка с кассой, профиль заведения. Сложенные подряд, они
 * превращают экран в километр прокрутки, где владелец ищет нужное глазами
 * вместо того, чтобы открыть. Вкладка отвечает на один вопрос целиком.
 *
 * Вкладка живёт в адресе (`?tab=`), как у «Акций»: ссылку на нужный раздел
 * можно дать сотруднику, а возврат «назад» не выбрасывает на первую вкладку.
 *
 * ТОЛЬКО ТО, ЧТО КАССА УЖЕ СОБЛЮДАЕТ. В конфигурации программы описаны ещё
 * режим «скидка» и срок жизни баллов — но касса их не применяет. Переключатель,
 * который ничего не делает, хуже отсутствующего: владелец включит «сгорание
 * через год» и будет уверен, что баллы сгорают. Такие настройки появляются
 * на экране вместе со своими механиками.
 *
 * У каждого блока своя кнопка сохранения: лестница статусов — отдельный вход
 * на сервере, и сохранение процента начисления не должно переписывать статусы.
 */

const TABS = ['program', 'rewards', 'guests', 'comms', 'security', 'venue'] as const

type SettingsTab = (typeof TABS)[number]

const TAB_LABELS: Readonly<Record<SettingsTab, TranslationKey>> = {
  program: 'settings.tab.program',
  rewards: 'settings.tab.rewards',
  guests: 'settings.tab.guests',
  comms: 'settings.tab.comms',
  security: 'settings.tab.security',
  venue: 'settings.tab.venue',
}

export function SettingsPage(): ReactElement {
  const t = useT()
  const settings = useProgramSettings()
  const [params, setParams] = useSearchParams()

  const asked = params.get('tab')
  const tab: SettingsTab = TABS.find((option) => option === asked) ?? 'program'

  const openTab = (next: SettingsTab): void => {
    // Первая вкладка — без параметра: адрес экрана настроек остаётся чистым.
    setParams(next === 'program' ? {} : { tab: next }, { replace: true })
  }

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
          <div className="tabs" role="tablist" aria-label={t('settings.tabs.label')}>
            {TABS.map((option) => (
              <button
                key={option}
                className={option === tab ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
                type="button"
                role="tab"
                aria-selected={option === tab}
                onClick={() => {
                  openTab(option)
                }}
              >
                {t(TAB_LABELS[option])}
              </button>
            ))}
          </div>

          {tab === 'program' ? (
            <>
              <SettingsForm initial={settings.data} />
              <TierSettingsSection />
            </>
          ) : null}

          {tab === 'rewards' ? (
            <>
              <BirthdaySettingsSection />
              <ReferralSettingsSection />
              <StaffRewardSettingsSection />
            </>
          ) : null}

          {tab === 'guests' ? (
            <>
              <ChannelSettingsSection />
              <TagSettingsSection />
            </>
          ) : null}

          {tab === 'comms' ? (
            <>
              <ReviewRepliesSection />
              <BotSettingsSection />
            </>
          ) : null}

          {tab === 'security' ? <SecuritySettingsSection /> : null}

          {tab === 'venue' ? (
            <>
              <ProfileSettingsSection />
              <IntegrationSettingsSection />
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
