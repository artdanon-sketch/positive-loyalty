import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'
import { useGuestReviews } from '../hooks'

/**
 * «Ответы заведений» на карте гостя. docs/02, раздел 2.8 · docs/11, У10.
 *
 * Только отзывы, на которые ответили, и только три последних: гость пришёл за кодом
 * для кассы, а не за перепиской. Ответов нет — блока нет.
 */

const SHOWN = 3

export function ReviewReplies(): ReactElement | null {
  const t = useT()
  const reviews = useGuestReviews()
  const answered = (reviews.data?.items ?? []).filter((review) => review.reply !== null)

  if (answered.length === 0) {
    return null
  }

  return (
    <section className="review" aria-labelledby="review-replies-title">
      <h2 className="card__sectionTitle" id="review-replies-title">
        {t('review.replies')}
      </h2>
      <ul className="review__list">
        {answered.slice(0, SHOWN).map((review) => (
          <li className="review__item" key={review.id}>
            <span className="review__venue">
              {`${review.venue} · ${'★'.repeat(review.rating)}`}
            </span>
            {review.comment === null ? null : <p className="review__comment">{review.comment}</p>}
            <p className="review__reply">{review.reply}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
