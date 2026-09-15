import type { ReactElement } from 'react'
import { engineOfferTexts } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useLocale, useT } from '../../../shared/i18n'
import { draftOffer } from '../draft'
import type { OfferDraft } from '../draft'
import { AUDIENCE_LABELS, PROBLEM_LABELS, TYPE_LABELS, WEEKDAYS } from '../labels'

/**
 * Шаг 3 — проверить и запустить. docs/03, раздел 4.
 *
 * Сводка словами: механика, кому, когда, ограничения. Переключателей «уведомить
 * гостей», «показать в каталоге сети» и «напомнить до конца» нет: ни каналов,
 * ни каталога ещё нет, а переключатель, который ничего не делает, хуже
 * отсутствующего.
 */

/** «2026-09-20» → «20.09.2026» без часовых поясов: дата уже по часам заведения. */
const localDate = (value: string): string => value.split('-').reverse().join('.')

export function OfferReview({ draft }: { draft: OfferDraft }): ReactElement {
  const t = useT()
  const locale = useLocale()
  const checked = draftOffer(draft, 'NOW')

  if (!checked.ok) {
    return (
      <p className="field__hint field__hint--error" role="status">
        {t(PROBLEM_LABELS[checked.problem])}
      </p>
    )
  }

  const { offer } = checked
  const { schedule, limits, audience } = offer

  const mechanics =
    engineOfferTexts({ title: offer.title, reward: offer.reward, limits }).howTo?.[locale] ?? []

  const when = [
    schedule.weekdays === undefined
      ? null
      : WEEKDAYS.filter(({ day }) => schedule.weekdays?.includes(day) === true)
          .map(({ label }) => t(label))
          .join(', '),
    schedule.timeWindow === undefined
      ? null
      : `${schedule.timeWindow.from}–${schedule.timeWindow.to}`,
    draft.startsOn.trim() === ''
      ? null
      : fill(t('offerNew.review.from'), { date: localDate(draft.startsOn.trim()) }),
    draft.endsOn.trim() === ''
      ? null
      : fill(t('offerNew.review.until'), { date: localDate(draft.endsOn.trim()) }),
  ].filter((part): part is string => part !== null)

  const restrictions = [
    limits.minCheck === undefined || limits.minCheck === null
      ? null
      : fill(t('offerNew.review.minCheck'), { amount: formatBaht(limits.minCheck) }),
    limits.perGuestQty === undefined || limits.perGuestQty === null
      ? null
      : fill(t('offerNew.review.perGuest'), { n: limits.perGuestQty }),
    limits.totalQty === undefined || limits.totalQty === null
      ? null
      : fill(t('offerNew.review.total'), { n: limits.totalQty }),
  ].filter((part): part is string => part !== null)

  return (
    <section className="panel" aria-labelledby="offer-review-title">
      <h2 className="constructor__section" id="offer-review-title">
        {t('offerNew.review.title')}
      </h2>

      <dl className="review">
        <div>
          <dt>{t('offerNew.review.name')}</dt>
          <dd>{offer.title}</dd>
        </div>
        <div>
          <dt>{t('offerNew.review.type')}</dt>
          <dd>
            {t(TYPE_LABELS[offer.type])}
            {mechanics.length === 0 ? null : ` — ${mechanics.join(' · ')}`}
          </dd>
        </div>
        <div>
          <dt>{t('offerNew.review.audience')}</dt>
          <dd>
            {audience.kind === 'SLEEPING'
              ? fill(t('offerNew.review.sleeping'), { n: audience.notVisitedDays })
              : t(AUDIENCE_LABELS[audience.kind])}
          </dd>
        </div>
        <div>
          <dt>{t('offerNew.review.when')}</dt>
          <dd>{when.length === 0 ? t('offerNew.review.always') : when.join(' · ')}</dd>
        </div>
        <div>
          <dt>{t('offerNew.review.limits')}</dt>
          <dd>
            {restrictions.length === 0 ? t('offerNew.review.noLimits') : restrictions.join(' · ')}
          </dd>
        </div>
      </dl>
    </section>
  )
}
