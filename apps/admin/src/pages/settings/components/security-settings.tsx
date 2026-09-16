import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { SuspiciousSettings } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useSaveSuspiciousSettings, useSuspiciousSettings } from '../hooks'
import { parseThreshold } from '../security-draft'

/**
 * Блок «Безопасность» в настройках. docs/03, раздел 9 · docs/11, У12.
 *
 * Порог подозрительных чеков — своим входом и своей кнопкой, и дорога в разбор:
 * история действий и подозрительное. Условия кассы (номер чека, потолок ручного ввода)
 * уже живут в форме программы выше — второй раз их здесь не показываем.
 */
export function SecuritySettingsSection(): ReactElement {
  const t = useT()
  const settings = useSuspiciousSettings()

  return (
    <section className="panel" aria-labelledby="security-settings-title">
      <h2 className="panel__title" id="security-settings-title">
        {t('securitySettings.title')}
      </h2>
      <p className="field__hint">{t('securitySettings.hint')}</p>
      <Link className="button" to="/settings/security">
        {t('securitySettings.open')}
      </Link>

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
        <ThresholdForm initial={settings.data} />
      )}
    </section>
  )
}

function ThresholdForm({ initial }: { initial: SuspiciousSettings }): ReactElement {
  const t = useT()
  const save = useSaveSuspiciousSettings()
  const [value, setValue] = useState(String(initial.maxChecksPerDay))

  const threshold = parseThreshold(value)
  const baseline = (save.data ?? initial).maxChecksPerDay
  const dirty = threshold === null || threshold !== baseline

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (threshold === null || !dirty || save.isPending) {
      return
    }

    save.mutate({ maxChecksPerDay: threshold })
  }

  return (
    <form className="review-replies-form" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="suspicious-threshold">
          {t('securitySettings.maxChecks')}
        </label>
        <input
          id="suspicious-threshold"
          className="field__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
      </div>

      <div className="save-bar">
        {threshold === null ? (
          <p className="state__hint state__hint--error" role="status">
            {t('securitySettings.problem')}
          </p>
        ) : save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : save.isSuccess && !dirty ? (
          <p className="save-bar__ok" role="status">
            {t('securitySettings.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={threshold === null || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('securitySettings.save')}
        </button>
      </div>
    </form>
  )
}
