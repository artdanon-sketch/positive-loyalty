import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import { ApiError } from '../../../shared/api/api-client'
import type { TranslationKey } from '../../../shared/i18n/dictionaries'
import { useT } from '../../../shared/i18n/i18n-context'
import { birthdayProblem, formatBirthday, todayIso } from '../birthday-date'
import { useMe, useSaveBirthday } from '../hooks'

/**
 * «Когда у вас день рождения?» на карте гостя. docs/02, раздел 2.7 · docs/11, У9.
 *
 * ВОПРОС — ТОЛЬКО ПОКА ДАТЫ НЕТ. Указана — блока нет: изменить её гость не может,
 * а место под кодом для кассы дороже.
 *
 * ПОДТВЕРЖДЕНИЕ ПЕРЕД ОТПРАВКОЙ. Дата указывается один раз (иначе подарок получали бы,
 * переставляя её), поэтому опечатку в годе нужно поймать до сервера, а не после.
 *
 * Профиль не загрузился — блок молчит: без него карта работает, и пугать гостя
 * ошибкой второстепенного вопроса незачем.
 */

const PROBLEMS: Readonly<Record<'empty' | 'format' | 'range', TranslationKey>> = {
  empty: 'birthday.problem.empty',
  format: 'birthday.problem.format',
  range: 'birthday.problem.range',
}

const ERRORS: Partial<Record<string, TranslationKey>> = {
  BIRTHDAY_ALREADY_SET: 'birthday.already',
  VALIDATION_FAILED: 'birthday.problem.range',
}

export function BirthdayPrompt(): ReactElement | null {
  const t = useT()
  const me = useMe()
  const save = useSaveBirthday()
  const [date, setDate] = useState('')
  const [touched, setTouched] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (save.isSuccess) {
    return (
      <section className="birthday" aria-labelledby="birthday-title">
        <h2 className="card__sectionTitle" id="birthday-title">
          {t('birthday.title')}
        </h2>
        <p className="birthday__hint" role="status">
          {t('birthday.saved')}
        </p>
      </section>
    )
  }

  if (!me.isSuccess || me.data.birthday !== null) {
    return null
  }

  const today = todayIso(new Date())
  const problem = birthdayProblem(date, today)

  const next = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setTouched(true)

    if (problem === null) {
      setConfirming(true)
    }
  }

  return (
    <section className="birthday" aria-labelledby="birthday-title">
      <h2 className="card__sectionTitle" id="birthday-title">
        {t('birthday.title')}
      </h2>

      {confirming ? (
        <>
          <p className="birthday__hint">
            {t('birthday.check').replace('{date}', formatBirthday(date.trim()))}
          </p>
          {save.isError ? (
            <p className="birthday__hint birthday__hint--error" role="alert">
              {t(
                (save.error instanceof ApiError ? ERRORS[save.error.code] : undefined) ??
                  'birthday.failed',
              )}
            </p>
          ) : null}
          <div className="birthday__actions">
            <button
              className="birthday__primary"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                save.mutate(date.trim())
              }}
            >
              {save.isPending ? t('birthday.saving') : t('birthday.confirm')}
            </button>
            <button
              className="birthday__link"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                save.reset()
                setConfirming(false)
              }}
            >
              {t('birthday.edit')}
            </button>
          </div>
        </>
      ) : (
        <form className="birthday__form" noValidate onSubmit={next}>
          <p className="birthday__hint">{t('birthday.hint')}</p>
          <label className="birthday__label" htmlFor="birthday-date">
            {t('birthday.date')}
          </label>
          <input
            id="birthday-date"
            className="birthday__input"
            type="date"
            min="1900-01-01"
            max={today}
            value={date}
            aria-invalid={touched && problem !== null}
            aria-describedby={touched && problem !== null ? 'birthday-problem' : undefined}
            onChange={(event) => {
              setDate(event.target.value)
            }}
          />
          {touched && problem !== null ? (
            <p className="birthday__hint birthday__hint--error" id="birthday-problem">
              {t(PROBLEMS[problem])}
            </p>
          ) : null}
          <div className="birthday__actions">
            <button className="birthday__primary" type="submit">
              {t('birthday.next')}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
