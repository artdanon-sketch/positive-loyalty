import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { REVIEW_COMMENT_MAX, REVIEW_TAGS } from '@positive/contracts'
import type { ReviewTag } from '@positive/contracts'

import { ApiError } from '../../../shared/api/api-client'
import type { TranslationKey } from '../../../shared/i18n/dictionaries'
import { useT } from '../../../shared/i18n/i18n-context'
import { useCreateReview, useGuestReviews } from '../hooks'

/**
 * «Как прошёл визит?» на карте гостя. docs/02, раздел 2.8 · docs/11, У10.
 *
 * ОДИН ВИЗИТ ЗА РАЗ. Сервер отдаёт до трёх неоценённых визитов, на карте — самый свежий:
 * просьба оценить три заведения подряд превращается в анкету, и гость не оценит ни одно.
 *
 * ЗВЁЗДЫ — ОБЯЗАТЕЛЬНО, ОСТАЛЬНОЕ — ПО ЖЕЛАНИЮ. Темы и комментарий появляются после
 * звезды: гостю, поставившему «5», писать ничего не нужно.
 *
 * ОТВЕТ ЗАВЕДЕНИЯ — СРАЗУ. Если у заведения задан автоответ, гость видит его сразу
 * после отправки: его услышали.
 *
 * Отзывы не загрузились — блок молчит: карта работает и без него.
 */

const TAG_LABELS: Readonly<Record<ReviewTag, TranslationKey>> = {
  QUALITY: 'review.tag.QUALITY',
  PRICE: 'review.tag.PRICE',
  ASSORTMENT: 'review.tag.ASSORTMENT',
  SERVICE: 'review.tag.SERVICE',
  STAFF: 'review.tag.STAFF',
}

const ERRORS: Partial<Record<string, TranslationKey>> = {
  REVIEW_EXISTS: 'review.error.exists',
  REVIEW_WINDOW_CLOSED: 'review.error.late',
  VISIT_NOT_FOUND: 'review.error.notFound',
}

const STARS = [1, 2, 3, 4, 5] as const

export function ReviewPrompt(): ReactElement | null {
  const t = useT()
  const reviews = useGuestReviews()
  const create = useCreateReview()
  const [rating, setRating] = useState<number | null>(null)
  const [tags, setTags] = useState<ReviewTag[]>([])
  const [comment, setComment] = useState('')

  if (create.isSuccess) {
    return (
      <section className="review" aria-labelledby="review-title">
        <h2 className="card__sectionTitle" id="review-title">
          {t('review.thanks')}
        </h2>
        {create.data.reply === null ? (
          <p className="review__hint" role="status">
            {t('review.sent')}
          </p>
        ) : (
          <div className="review__answer" role="status">
            <p className="review__hint">
              {t('review.replyFrom').replace('{venue}', create.data.venue)}
            </p>
            <p className="review__reply">{create.data.reply}</p>
          </div>
        )}
        <button
          className="review__link"
          type="button"
          onClick={() => {
            create.reset()
            setRating(null)
            setTags([])
            setComment('')
          }}
        >
          {t('review.done')}
        </button>
      </section>
    )
  }

  const visit = reviews.data?.pending[0]

  if (visit === undefined) {
    return null
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (rating === null || create.isPending) {
      return
    }

    const text = comment.trim()

    create.mutate({
      ledgerEntryId: visit.ledgerEntryId,
      rating,
      tags,
      ...(text === '' ? {} : { comment: text }),
    })
  }

  return (
    <section className="review" aria-labelledby="review-title">
      <h2 className="card__sectionTitle" id="review-title">
        {t('review.title').replace('{venue}', visit.venue)}
      </h2>

      <form className="review__form" onSubmit={submit}>
        <div className="review__stars" role="group" aria-label={t('review.rating')}>
          {STARS.map((value) => (
            <button
              key={value}
              className={
                rating !== null && value <= rating
                  ? 'review__star review__star--on'
                  : 'review__star'
              }
              type="button"
              aria-pressed={rating === value}
              aria-label={t('review.star').replace('{n}', String(value))}
              onClick={() => {
                setRating(value)
              }}
            >
              ★
            </button>
          ))}
        </div>

        {rating === null ? null : (
          <>
            <div className="review__tags" role="group" aria-label={t('review.tags')}>
              {REVIEW_TAGS.map((tag) => (
                <button
                  key={tag}
                  className={tags.includes(tag) ? 'review__tag review__tag--on' : 'review__tag'}
                  type="button"
                  aria-pressed={tags.includes(tag)}
                  onClick={() => {
                    setTags(tags.includes(tag) ? tags.filter((one) => one !== tag) : [...tags, tag])
                  }}
                >
                  {t(TAG_LABELS[tag])}
                </button>
              ))}
            </div>

            <label className="review__label" htmlFor="review-comment">
              {t('review.comment')}
            </label>
            <textarea
              id="review-comment"
              className="review__input"
              rows={3}
              maxLength={REVIEW_COMMENT_MAX}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value)
              }}
            />

            {create.isError ? (
              <p className="review__hint review__hint--error" role="alert">
                {t(
                  (create.error instanceof ApiError ? ERRORS[create.error.code] : undefined) ??
                    'review.error.failed',
                )}
              </p>
            ) : null}

            <button className="review__primary" type="submit" disabled={create.isPending}>
              {create.isPending ? t('review.sending') : t('review.send')}
            </button>
          </>
        )}
      </form>
    </section>
  )
}
