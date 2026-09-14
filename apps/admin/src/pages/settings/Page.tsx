import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n'
import { SettingsForm } from './components/settings-form'
import { useProgramSettings } from './hooks'

/**
 * Экран «Настройки программы»: сколько гость получает и как тратит баллы.
 *
 * ТОЛЬКО ТО, ЧТО КАССА УЖЕ СОБЛЮДАЕТ. В конфигурации программы описаны ещё
 * режим «скидка», срок жизни баллов, приветственные баллы и статусы — но касса
 * их не применяет. Переключатель, который ничего не делает, хуже отсутствующего:
 * владелец включит «сгорание через год» и будет уверен, что баллы сгорают.
 * Эти настройки появятся на экране вместе со своими механиками.
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
        <SettingsForm initial={settings.data} />
      )}
    </section>
  )
}
