import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { NEWS_BODY_MAX, NEWS_TITLE_MAX } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { BLANK_NEWS, fromNewsDraft } from '../news-draft'
import type { NewsDraft, NewsProblem } from '../news-draft'
import { useCreateNews } from '../news-hooks'

/**
 * Форма новой новости — только у владельца. docs/02, раздел 5.14 · docs/11, У13.
 *
 * По умолчанию — черновик: текст для всех гостей заведения лучше перечитать в списке
 * и выпустить кнопкой, чем отправить опечатку. «Сразу показать гостям» — для тех, кто уверен.
 */

const PROBLEMS: Readonly<Record<NewsProblem, TranslationKey>> = {
  title: 'news.problem.title',
  body: 'news.problem.body',
}

export function NewsForm(): ReactElement {
  const t = useT()
  const create = useCreateNews()
  const [draft, setDraft] = useState<NewsDraft>(BLANK_NEWS)
  const [touched, setTouched] = useState(false)

  const checked = fromNewsDraft(draft)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setTouched(true)

    if (!checked.ok || create.isPending) {
      return
    }

    create.mutate(checked.input, {
      onSuccess: () => {
        setDraft(BLANK_NEWS)
        setTouched(false)
      },
    })
  }

  return (
    <form className="panel review-replies-form" aria-labelledby="news-form-title" onSubmit={submit}>
      <h2 className="panel__title" id="news-form-title">
        {t('news.form.title')}
      </h2>

      <div className="field">
        <label className="field__label" htmlFor="news-field-title">
          {t('news.field.title')}
        </label>
        <input
          id="news-field-title"
          className="field__input"
          type="text"
          maxLength={NEWS_TITLE_MAX}
          autoComplete="off"
          value={draft.title}
          onChange={(event) => {
            setDraft({ ...draft, title: event.target.value })
          }}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="news-body">
          {t('news.field.body')}
        </label>
        <textarea
          id="news-body"
          className="field__input review-card__textarea"
          rows={4}
          maxLength={NEWS_BODY_MAX}
          value={draft.body}
          onChange={(event) => {
            setDraft({ ...draft, body: event.target.value })
          }}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.publish}
          onChange={(event) => {
            setDraft({ ...draft, publish: event.target.checked })
          }}
        />
        <span className="toggle__text">{t('news.publishNow')}</span>
      </label>

      <div className="save-bar">
        {touched && !checked.ok ? (
          <p className="state__hint state__hint--error" role="status">
            {t(PROBLEMS[checked.problem])}
          </p>
        ) : create.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {create.error.message}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('news.create')}
        </button>
      </div>
    </form>
  )
}
