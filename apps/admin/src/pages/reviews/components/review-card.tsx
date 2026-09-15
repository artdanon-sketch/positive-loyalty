import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { REVIEW_REPLY_MAX } from '@positive/contracts'
import type { AdminReview } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useReplyReview } from '../hooks'
import { TAG_LABELS } from '../tag-labels'

/**
 * Отзыв в списке. docs/03 · docs/11, У10.
 *
 * ОТВЕТ В ОДИН ШАГ. Поле ответа открыто сразу, если гостю ещё не ответили: владелец
 * читает жалобу и тут же пишет, без «открыть → ответить → подтвердить».
 *
 * АВТООТВЕТ ПОМЕЧЕН. Гостю они не различаются, а владельцу важно знать, что гость
 * пока слышал только вежливость, — поэтому «ответить самому» остаётся под рукой.
 */
export function ReviewCard({ review }: { review: AdminReview }): ReactElement {
  const t = useT()
  const reply = useReplyReview()
  const [editing, setEditing] = useState(review.reply === null)
  const [text, setText] = useState('')

  const trimmed = text.trim()
  const ready = trimmed !== '' && trimmed.length <= REVIEW_REPLY_MAX
  const titleId = `review-${review.id}`
  const fieldId = `review-reply-${review.id}`

  const startEditing = (): void => {
    reply.reset()
    setText(review.autoReply ? '' : (review.reply ?? ''))
    setEditing(true)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || reply.isPending) {
      return
    }

    reply.mutate(
      { id: review.id, text: trimmed },
      {
        onSuccess: () => {
          setEditing(false)
          setText('')
        },
      },
    )
  }

  return (
    <article className="review-card" aria-labelledby={titleId}>
      <header className="review-card__head">
        <h3 className="review-card__title" id={titleId}>
          <span
            className="review-card__stars"
            aria-label={fill(t('reviews.rating'), { n: review.rating })}
          >
            {'★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)}
          </span>{' '}
          <Link className="review-card__guest" to={`/guests?guest=${review.guest.guestId}`}>
            {review.guest.displayName ?? t('guests.noName')}
          </Link>
        </h3>
        <time className="review-card__date" dateTime={review.createdAt}>
          {formatDateTime(review.createdAt)}
        </time>
      </header>

      <p className="review-card__meta">
        {review.staff === null
          ? t('reviews.cashierNone')
          : fill(t('reviews.cashier'), { name: review.staff.displayName })}
        {review.amount === null
          ? null
          : ` · ${fill(t('reviews.amount'), { amount: formatBaht(review.amount) })}`}
        {review.guest.phone === null ? null : ` · ${review.guest.phone}`}
      </p>

      {review.tags.length === 0 ? null : (
        <p className="review-card__tags">
          {review.tags.map((tag) => (
            <span className="chip chip--neutral" key={tag}>
              {t(TAG_LABELS[tag])}
            </span>
          ))}
        </p>
      )}

      <p
        className={review.comment === null ? 'review-card__comment--empty' : 'review-card__comment'}
      >
        {review.comment ?? t('reviews.noComment')}
      </p>

      {review.reply !== null && !editing ? (
        <div className="review-card__reply">
          <span className={review.autoReply ? 'chip chip--muted' : 'chip chip--good'}>
            {t(review.autoReply ? 'reviews.autoReply' : 'reviews.replied')}
          </span>
          <p className="review-card__replyText">{review.reply}</p>
          <button className="link-button" type="button" onClick={startEditing}>
            {t(review.autoReply ? 'reviews.replyYourself' : 'reviews.editReply')}
          </button>
        </div>
      ) : (
        <form className="review-card__form" onSubmit={submit}>
          <label className="field__label" htmlFor={fieldId}>
            {t('reviews.replyLabel')}
          </label>
          <textarea
            id={fieldId}
            className="field__input review-card__textarea"
            rows={2}
            maxLength={REVIEW_REPLY_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
          {reply.isError ? (
            <p className="state__hint state__hint--error" role="alert">
              {reply.error.message}
            </p>
          ) : null}
          <div className="panel__actions">
            {review.reply === null ? null : (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setEditing(false)
                }}
              >
                {t('reviews.cancel')}
              </button>
            )}
            <button
              className="button button--primary"
              type="submit"
              disabled={!ready || reply.isPending}
            >
              {reply.isPending ? t('common.saving') : t('reviews.send')}
            </button>
          </div>
        </form>
      )}
    </article>
  )
}
