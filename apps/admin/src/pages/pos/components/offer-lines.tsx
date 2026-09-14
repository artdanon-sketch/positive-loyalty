import type { ReactElement } from 'react'
import type { AppliedOffer, IssuedGrant, SkippedOffer } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Акции в чеке: что применилось и почему не применилось остальное.
 *
 * docs/02, раздел 3.2: объяснение — не роскошь. Именно его кассир говорит гостю,
 * и именно его отсутствие ломает доверие к программе. Поэтому причина
 * показывается словами сервера, а не кодом.
 */
export function OfferLines({
  applied,
  skipped,
}: {
  applied: readonly AppliedOffer[]
  skipped: readonly SkippedOffer[]
}): ReactElement | null {
  const t = useT()

  if (applied.length === 0 && skipped.length === 0) {
    return null
  }

  return (
    <div className="pos-offers">
      {applied.length === 0 ? null : (
        <ul className="pos-offers__list" aria-label={t('pos.offers.applied')}>
          {applied.map((offer) => (
            <li key={offer.offerId} className="pos-offers__item pos-offers__item--applied">
              <span>{offer.title ?? t('pos.offers.untitled')}</span>
              <b>
                {offer.grantAfterPayment
                  ? t('pos.offers.afterPayment')
                  : `+${formatBaht(offer.earnDelta)}`}
              </b>
            </li>
          ))}
        </ul>
      )}

      {skipped.length === 0 ? null : (
        <ul className="pos-offers__list" aria-label={t('pos.offers.skipped')}>
          {skipped.map((offer) => (
            <li key={offer.offerId} className="pos-offers__item pos-offers__item--skipped">
              <span>{offer.title ?? t('pos.offers.untitled')}</span>
              <span className="pos-offers__why">{offer.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Промокоды, выданные за чек. Кассиру — только хвост кода: полный гость видит
 * у себя в приложении, и зачитывать его вслух незачем.
 */
export function IssuedGrants({ grants }: { grants: readonly IssuedGrant[] }): ReactElement | null {
  const t = useT()

  if (grants.length === 0) {
    return null
  }

  return (
    <ul className="pos-offers__list" aria-label={t('pos.offers.issued')}>
      {grants.map((grant) => (
        <li key={grant.grantId} className="pos-offers__item pos-offers__item--applied">
          <span>
            {fill(t('pos.offers.issuedLine'), { title: grant.title ?? t('pos.offers.untitled') })}
          </span>
          <span className="pos-offers__why">•••• {grant.codeTail}</span>
        </li>
      ))}
    </ul>
  )
}
