import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { GuestLocale, GuestMe } from '@positive/contracts'

import { useT } from '../../../shared/i18n/i18n-context'
import { useMe, useSaveProfile } from '../hooks'

/**
 * «О себе» на карте гостя. docs/02, раздел 2.12.
 *
 * ИМЯ И ЯЗЫК — И БОЛЬШЕ НИЧЕГО. Телефон меняется входом по новому номеру,
 * день рождения ставится один раз, «турист или резидент» — наблюдение системы,
 * а не анкета.
 *
 * ЗАКРЫТ ПО УМОЛЧАНИЮ, как и история: карту открывают ради кода кассиру.
 *
 * ТЕЛЕФОН ПОКАЗЫВАЕМ МАСКОЙ И БЕЗ ПОЛЯ ВВОДА — чтобы гость убедился, что это
 * его карта, а не чужая, открытая на общем телефоне.
 */

const LOCALES: readonly GuestLocale[] = ['ru', 'en', 'th']

function ProfileForm({ me }: { me: GuestMe }): ReactElement {
  const t = useT()
  const save = useSaveProfile()
  const [name, setName] = useState(me.displayName ?? '')
  const [locale, setLocale] = useState<GuestLocale>(
    me.locale === 'ru' || me.locale === 'en' ? me.locale : 'th',
  )

  const trimmed = name.trim()
  const nameBroken = trimmed.length === 1

  const submit = (event: FormEvent): void => {
    event.preventDefault()

    if (nameBroken || save.isPending) {
      return
    }

    save.mutate({ displayName: trimmed === '' ? null : trimmed, locale })
  }

  return (
    <form className="profile" onSubmit={submit}>
      <label className="profile__label" htmlFor="profile-name">
        {t('profile.name')}
      </label>
      <input
        className="profile__input"
        id="profile-name"
        maxLength={60}
        type="text"
        value={name}
        onChange={(event) => {
          setName(event.target.value)
        }}
      />
      <p className="profile__hint">{nameBroken ? t('profile.nameShort') : t('profile.nameHint')}</p>

      <label className="profile__label" htmlFor="profile-locale">
        {t('profile.language')}
      </label>
      <select
        className="profile__input"
        id="profile-locale"
        value={locale}
        onChange={(event) => {
          setLocale(event.target.value as GuestLocale)
        }}
      >
        {LOCALES.map((item) => (
          <option key={item} value={item}>
            {t(`profile.language.${item}` as 'profile.language.ru')}
          </option>
        ))}
      </select>
      <p className="profile__hint">{t('profile.languageHint')}</p>

      {me.phoneMasked === null ? null : (
        <p className="profile__hint">
          {t('profile.phone')}: {me.phoneMasked}
        </p>
      )}

      {save.isError ? (
        <p className="profile__hint profile__hint--error" role="alert">
          {save.error.message}
        </p>
      ) : null}

      {save.isSuccess ? (
        <p className="profile__hint" role="status">
          {t('profile.saved')}
        </p>
      ) : null}

      <button className="profile__save" disabled={save.isPending || nameBroken} type="submit">
        {save.isPending ? t('profile.saving') : t('profile.save')}
      </button>
    </form>
  )
}

export function ProfileCard(): ReactElement {
  const t = useT()
  const [open, setOpen] = useState(false)
  const me = useMe()

  if (!open) {
    return (
      <section className="history">
        <button
          className="history__toggle"
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          {t('profile.show')}
        </button>
      </section>
    )
  }

  return (
    <section className="history" aria-labelledby="profile-title">
      <h2 className="card__sectionTitle" id="profile-title">
        {t('profile.title')}
      </h2>

      {me.isPending ? (
        <p className="profile__hint" role="status">
          {t('history.loading')}
        </p>
      ) : me.isError ? (
        <p className="profile__hint profile__hint--error" role="alert">
          {me.error.message}
        </p>
      ) : (
        <ProfileForm me={me.data} />
      )}
    </section>
  )
}
