import type { ReactElement } from 'react'
import type { AdminGuestCard, GuestSource } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht, formatDate, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'

/**
 * Шапка карточки: кто это для заведения и четыре цифры.
 *
 * Контрольная группа объясняется словами прямо здесь: иначе владелец увидит
 * у постоянного гостя ноль баллов и решит, что касса сломалась.
 */

const SOURCE_LABELS: Readonly<Record<GuestSource, TranslationKey>> = {
  ORGANIC: 'guestCard.source.organic',
  CATALOG: 'guestCard.source.catalog',
  REFERRAL: 'guestCard.source.referral',
  STAFF: 'guestCard.source.staff',
  IMPORT: 'guestCard.source.import',
}

export function GuestSummary({ card }: { card: AdminGuestCard }): ReactElement {
  const t = useT()

  return (
    <>
      <div className="guest-card__meta">
        <span className={`chip ${card.mode === 'TOURIST' ? 'chip--neutral' : 'chip--good'}`}>
          {t(card.mode === 'TOURIST' ? 'guests.mode.tourist' : 'guests.mode.resident')}
        </span>
        {card.tier === null ? null : (
          <span className="chip chip--good">
            {card.tier.manual
              ? fill(t('guestCard.tier.manual'), { name: card.tier.name })
              : card.tier.name}
          </span>
        )}
        {card.isControlGroup ? (
          <span className="chip chip--muted">{t('guests.controlGroup')}</span>
        ) : null}
        <span className="chip chip--muted">{t(SOURCE_LABELS[card.source])}</span>
      </div>

      <dl className="guest-card__facts">
        <div>
          <dt>{t('guestCard.phone')}</dt>
          <dd className="data-table__mono">{card.phone ?? t('guestCard.noPhone')}</dd>
        </div>
        <div>
          <dt>{t('guestCard.since')}</dt>
          <dd>{formatDate(card.firstVisitAt)}</dd>
        </div>
        <div>
          <dt>{t('guestCard.lastVisit')}</dt>
          <dd>{formatDateTime(card.lastVisitAt)}</dd>
        </div>
      </dl>

      {card.isControlGroup ? (
        <p className="guest-card__note">{t('guestCard.controlGroupHint')}</p>
      ) : null}

      <dl className="guest-card__tiles">
        <div className="guest-card__tile">
          <dt>{t('guestCard.tile.points')}</dt>
          <dd>{formatBaht(card.pointsBalance)}</dd>
        </div>
        <div className="guest-card__tile">
          <dt>{t('guestCard.tile.visits')}</dt>
          <dd>{card.visitsTotal}</dd>
        </div>
        <div className="guest-card__tile">
          <dt>{t('guestCard.tile.spent')}</dt>
          <dd>{formatBaht(card.spentTotal)}</dd>
        </div>
        <div className="guest-card__tile">
          <dt>{t('guestCard.tile.average')}</dt>
          <dd>{card.averageCheck === null ? '—' : formatBaht(card.averageCheck)}</dd>
        </div>
      </dl>
    </>
  )
}
