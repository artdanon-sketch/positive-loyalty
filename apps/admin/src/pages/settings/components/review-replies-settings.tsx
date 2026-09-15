import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ReviewSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { useReviewSettings, useSaveReviewSettings } from '../hooks'
import { fromRepliesDraft, toRepliesDraft } from '../review-replies-draft'

/**
 * Блок «Автоответы на отзывы» в настройках. docs/03, раздел 9 · docs/11, У10.
 *
 * Свои данные и своя кнопка сохранения, как у подарка ко дню рождения. Форма
 * заводится из загруженных значений один раз — без эффекта, переписывающего поля.
 */
export function ReviewRepliesSection(): ReactElement {
  const t = useT()
  const settings = useReviewSettings()

  return (
    <section className="panel" aria-labelledby="review-replies-title">
      <h2 className="panel__title" id="review-replies-title">
        {t('reviewReplies.title')}
      </h2>
      <p className="field__hint">{t('reviewReplies.hint')}</p>

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
        <ReviewRepliesForm initial={settings.data} />
      )}
    </section>
  )
}

function ReviewRepliesForm({ initial }: { initial: ReviewSettings }): ReactElement {
  const t = useT()
  const save = useSaveReviewSettings()
  const [draft, setDraft] = useState<string[]>(() => toRepliesDraft(initial))

  const checked = fromRepliesDraft(draft)
  const baseline = save.data ?? initial
  const dirty = !checked.ok || JSON.stringify(checked.settings) !== JSON.stringify(baseline)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!checked.ok || !dirty || save.isPending) {
      return
    }

    save.mutate(checked.settings)
  }

  return (
    <form className="review-replies-form" onSubmit={submit}>
      {draft.map((value, index) => {
        const rating = index + 1
        const id = `review-reply-${String(rating)}`

        return (
          <div className="field" key={id}>
            <label className="field__label" htmlFor={id}>
              {fill(t('reviewReplies.rating'), { n: rating })}
            </label>
            <textarea
              id={id}
              className="field__input review-card__textarea"
              rows={2}
              value={value}
              onChange={(event) => {
                setDraft(draft.map((current, at) => (at === index ? event.target.value : current)))
              }}
            />
          </div>
        )
      })}

      <div className="save-bar">
        {!checked.ok ? (
          <p className="state__hint state__hint--error" role="status">
            {fill(t('reviewReplies.tooLong'), { n: checked.rating })}
          </p>
        ) : save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : save.isSuccess && !dirty ? (
          <p className="save-bar__ok" role="status">
            {t('reviewReplies.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={!checked.ok || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('reviewReplies.save')}
        </button>
      </div>
    </form>
  )
}
