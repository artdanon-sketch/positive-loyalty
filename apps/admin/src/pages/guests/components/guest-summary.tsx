import type { ReactElement } from 'react'
import type { AdminGuestCard } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht, formatDate, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { SOURCE_LABELS } from '../labels'

/**
 * Шапка карточки: кто это для заведения и четыре цифры.
 *
 * Контрольная группа объясняется словами прямо здесь: иначе владелец увидит
 * у постоянного гостя ноль баллов и решит, что касса сломалась.
 */

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
        {card.channel === null ? null : (
          <span className="chip chip--neutral">
            {fill(t('guestCard.channel'), { name: card.channel.name })}
          </span>
        )}
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
        {card.referral.invitedBy === null ? null : (
          <div>
            <dt>{t('guestCard.referral.invitedBy')}</dt>
            <dd>{card.referral.invitedBy.displayName ?? t('guestCard.referral.noName')}</dd>
          </div>
        )}
        {card.referral.invited === 0 ? null : (
          <div>
            <dt>{t('guestCard.referral.invited')}</dt>
            <dd>
              {fill(t('guestCard.referral.count'), {
                invited: card.referral.invited,
                rewarded: card.referral.rewarded,
              })}
            </dd>
          </div>
        )}
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
