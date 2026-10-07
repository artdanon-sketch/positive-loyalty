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
 * Настройки: витрина карточек, а не один свиток. docs/03, раздел 9.
 *
 * Разделов одиннадцать. Сложенные подряд, они превращали экран в километр
 * прокрутки, где владелец искал нужное глазами. Вкладки эту беду лечат
 * наполовину: ярлык из одного слова заставляет гадать, что внутри, и разное
 * приходится сваливать под общим именем.
 *
 * Поэтому витрина: у карточки есть строка, объясняющая, что за ней, — и
 * владелец выбирает по смыслу, а не по догадке. Так же устроены настройки
 * у UDS, откуда владелец к нам приходит.
 *
 * Раздел живёт в адресе (`?section=`): ссылку на нужный можно дать сотруднику,
 * а «назад» в браузере возвращает на витрину, а не выбрасывает с экрана.
 *
 * ТОЛЬКО ТО, ЧТО КАССА УЖЕ СОБЛЮДАЕТ. В конфигурации программы описаны ещё
 * режим «скидка» и срок жизни баллов, но касса их не применяет. Переключатель,
 * который ничего не делает, хуже отсутствующего: владелец включит «сгорание
 * через год» и будет уверен, что баллы сгорают.
 *
 * У каждого раздела свои данные и своя кнопка сохранения: лестница статусов —
 * отдельный вход на сервере, и сохранение процента начисления не должно
 * переписывать статусы.
 */

const SECTIONS = [
  'profile',
  'program',
  'referral',
  'birthday',
  'staffReward',
  'sources',
  'tags',
  'reviews',
  'bot',
  'security',
  'integration',
] as const

type SettingsSection = (typeof SECTIONS)[number]

const NAME: Readonly<Record<SettingsSection, TranslationKey>> = {
  profile: 'settings.hub.profile.name',
  program: 'settings.hub.program.name',
  referral: 'settings.hub.referral.name',
  birthday: 'settings.hub.birthday.name',
  staffReward: 'settings.hub.staffReward.name',
  sources: 'settings.hub.sources.name',
  tags: 'settings.hub.tags.name',
  reviews: 'settings.hub.reviews.name',
  bot: 'settings.hub.bot.name',
  security: 'settings.hub.security.name',
  integration: 'settings.hub.integration.name',
}

const ABOUT: Readonly<Record<SettingsSection, TranslationKey>> = {
  profile: 'settings.hub.profile.about',
  program: 'settings.hub.program.about',
  referral: 'settings.hub.referral.about',
  birthday: 'settings.hub.birthday.about',
  staffReward: 'settings.hub.staffReward.about',
  sources: 'settings.hub.sources.about',
  tags: 'settings.hub.tags.about',
  reviews: 'settings.hub.reviews.about',
  bot: 'settings.hub.bot.about',
  security: 'settings.hub.security.about',
  integration: 'settings.hub.integration.about',
}

export function SettingsPage(): ReactElement {
  const t = useT()
  const settings = useProgramSettings()
  const [params, setParams] = useSearchParams()

  const asked = params.get('section')
  const section = SECTIONS.find((option) => option === asked) ?? null

  const open = (next: SettingsSection | null): void => {
    setParams(next === null ? {} : { section: next }, { replace: false })
  }

  const body = (): ReactElement => {
    if (settings.isPending) {
      return (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      )
    }

    if (settings.isError) {
      return (
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
      )
    }

    if (section === null) {
      return (
        <div className="hub">
          {SECTIONS.map((option) => (
            <button
              key={option}
              className="hub__card"
              type="button"
              onClick={() => {
                open(option)
              }}
            >
              <span className="hub__name">{t(NAME[option])}</span>
              <span className="hub__about">{t(ABOUT[option])}</span>
            </button>
          ))}
        </div>
      )
    }

    return (
      <>
        <button
          className="hub__back"
          type="button"
          onClick={() => {
            open(null)
          }}
        >
          {t('settings.hub.back')}
        </button>

        {section === 'profile' ? <ProfileSettingsSection /> : null}
        {section === 'program' ? (
          <>
            <SettingsForm initial={settings.data} />
            <TierSettingsSection />
          </>
        ) : null}
        {section === 'referral' ? <ReferralSettingsSection /> : null}
        {section === 'birthday' ? <BirthdaySettingsSection /> : null}
        {section === 'staffReward' ? <StaffRewardSettingsSection /> : null}
        {section === 'sources' ? <ChannelSettingsSection /> : null}
        {section === 'tags' ? <TagSettingsSection /> : null}
        {section === 'reviews' ? <ReviewRepliesSection /> : null}
        {section === 'bot' ? <BotSettingsSection /> : null}
        {section === 'security' ? <SecuritySettingsSection /> : null}
        {section === 'integration' ? <IntegrationSettingsSection /> : null}
      </>
    )
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{section === null ? t('settings.title') : t(NAME[section])}</h1>
        <p className="page__subtitle">
          {section === null ? t('settings.subtitle') : t(ABOUT[section])}
        </p>
      </header>

      {body()}
    </section>
  )
}
