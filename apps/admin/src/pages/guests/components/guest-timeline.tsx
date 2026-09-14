import type { ReactElement } from 'react'
import type { AdminGuestCard } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { TimelineGift } from './timeline-gift'
import { TimelineOperation } from './timeline-operation'

/**
 * История гостя одной лентой: чеки, отмены и подарки на одной оси времени.
 * Спор у стойки — «не начислили за вчера, а подарок не дали» — решается
 * взглядом сверху вниз, без переключения вкладок.
 */
export function GuestTimeline({ card }: { card: AdminGuestCard }): ReactElement {
  const t = useT()

  return (
    <section aria-labelledby="guest-timeline-title">
      <h3 className="guest-card__section" id="guest-timeline-title">
        {t('guestCard.timeline.title')}
      </h3>

      {card.timeline.length === 0 ? (
        <p className="state__hint">{t('guestCard.timeline.empty')}</p>
      ) : (
        <ol className="timeline">
          {card.timeline.map((item) =>
            item.kind === 'OPERATION' ? (
              <TimelineOperation key={item.id} item={item} controlGroup={card.isControlGroup} />
            ) : (
              <TimelineGift key={item.grantId} item={item} />
            ),
          )}
        </ol>
      )}

      {card.timelineTruncated ? (
        <p className="field__hint">{t('guestCard.timeline.truncated')}</p>
      ) : null}
    </section>
  )
}
