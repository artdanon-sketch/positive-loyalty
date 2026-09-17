import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { TenantProfile } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import {
  emptyToNull,
  LOCALES,
  profileIssues,
  TIMEZONES,
  VERTICAL_LABEL,
  VERTICALS,
} from '../profile-draft'
import { useSaveTenantProfile } from '../profile-hooks'

/**
 * Форма профиля заведения. docs/03, раздел 9.
 *
 * НАЧАЛЬНЫЕ ЗНАЧЕНИЯ ПРИХОДЯТ СВЕРХУ И БОЛЬШЕ НЕ ОБНОВЛЯЮТСЯ: иначе ответ
 * сервера переписывал бы поля поверх того, что владелец успел набрать.
 */
export function ProfileForm({ initial }: { initial: TenantProfile }): ReactElement {
  const t = useT()
  const save = useSaveTenantProfile()
  const [draft, setDraft] = useState<TenantProfile>(initial)

  const issues = profileIssues(draft)

  const submit = (event: FormEvent): void => {
    event.preventDefault()

    if (issues.length > 0) {
      return
    }

    save.mutate({
      ...draft,
      brandName: draft.brandName.trim(),
      legalName: draft.legalName === null ? null : emptyToNull(draft.legalName),
      phone: draft.phone === null ? null : emptyToNull(draft.phone),
      website: draft.website === null ? null : emptyToNull(draft.website),
      about: draft.about.trim(),
      address: draft.address.trim(),
      hours: draft.hours.trim(),
    })
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="profile-brand">
          {t('profile.brandName')}
        </label>
        <input
          className="field__input"
          id="profile-brand"
          maxLength={80}
          type="text"
          value={draft.brandName}
          onChange={(event) => {
            setDraft({ ...draft, brandName: event.target.value })
          }}
        />
        <p className="field__hint">{t('profile.brandNameHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-legal">
          {t('profile.legalName')}
        </label>
        <input
          className="field__input"
          id="profile-legal"
          maxLength={160}
          type="text"
          value={draft.legalName ?? ''}
          onChange={(event) => {
            setDraft({ ...draft, legalName: event.target.value })
          }}
        />
        <p className="field__hint">{t('profile.legalNameHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-vertical">
          {t('profile.vertical')}
        </label>
        <select
          className="field__input"
          id="profile-vertical"
          value={draft.vertical}
          onChange={(event) => {
            setDraft({ ...draft, vertical: event.target.value as TenantProfile['vertical'] })
          }}
        >
          {VERTICALS.map((vertical) => (
            <option key={vertical} value={vertical}>
              {t(VERTICAL_LABEL[vertical])}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-timezone">
          {t('profile.timezone')}
        </label>
        <select
          className="field__input"
          id="profile-timezone"
          value={draft.timezone}
          onChange={(event) => {
            setDraft({ ...draft, timezone: event.target.value })
          }}
        >
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="field__hint">{t('profile.timezoneHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-locale">
          {t('profile.locale')}
        </label>
        <select
          className="field__input"
          id="profile-locale"
          value={draft.locale}
          onChange={(event) => {
            setDraft({ ...draft, locale: event.target.value as TenantProfile['locale'] })
          }}
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {locale.toUpperCase()}
            </option>
          ))}
        </select>
        <p className="field__hint">{t('profile.localeHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-about">
          {t('profile.about')}
        </label>
        <textarea
          className="field__input review-card__textarea"
          id="profile-about"
          maxLength={500}
          rows={3}
          value={draft.about}
          onChange={(event) => {
            setDraft({ ...draft, about: event.target.value })
          }}
        />
        <p className="field__hint">{t('profile.aboutHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-phone">
          {t('profile.phone')}
        </label>
        <input
          className="field__input"
          id="profile-phone"
          maxLength={32}
          type="tel"
          value={draft.phone ?? ''}
          onChange={(event) => {
            setDraft({ ...draft, phone: event.target.value })
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-website">
          {t('profile.website')}
        </label>
        <input
          className="field__input"
          id="profile-website"
          maxLength={200}
          placeholder="https://"
          type="url"
          value={draft.website ?? ''}
          onChange={(event) => {
            setDraft({ ...draft, website: event.target.value })
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-address">
          {t('profile.address')}
        </label>
        <input
          className="field__input"
          id="profile-address"
          maxLength={200}
          type="text"
          value={draft.address}
          onChange={(event) => {
            setDraft({ ...draft, address: event.target.value })
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="profile-hours">
          {t('profile.hours')}
        </label>
        <input
          className="field__input"
          id="profile-hours"
          maxLength={120}
          type="text"
          value={draft.hours}
          onChange={(event) => {
            setDraft({ ...draft, hours: event.target.value })
          }}
        />
        <p className="field__hint">{t('profile.hoursHint')}</p>
      </div>

      {issues.length > 0 ? (
        <ul className="state__hint">
          {issues.map((issue) => (
            <li key={issue}>{t(issue)}</li>
          ))}
        </ul>
      ) : null}

      <div className="save-bar">
        {save.isSuccess ? (
          <p className="save-bar__ok" role="status">
            {t('profile.saved')}
          </p>
        ) : null}
        {save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : null}
        <button
          className="button button--primary"
          disabled={save.isPending || issues.length > 0}
          type="submit"
        >
          {save.isPending ? t('common.saving') : t('profile.save')}
        </button>
      </div>
    </form>
  )
}
