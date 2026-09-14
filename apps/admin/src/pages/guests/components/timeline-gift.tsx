import type { ReactElement } from 'react'
import type { AdminGiftState, AdminTimelineGift } from '@positive/contracts'

import { formatDate, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'

/**
 * Подарок в истории гостя — одной строкой со всем путём:
 * «выдан → погашен 05.09, чек 1042 · код …K7QX».
 *
 * Привязка погашения к чеку в системе есть, и здесь она впервые видна человеку:
 * на «подарок не дали» ответ — номер чека, в котором его отдали.
 *
 * От кода показан только хвост: код — это сам подарок, и полного значения
 * у бэк-офиса нет вовсе (docs/02, раздел 5.2).
 */

type Translate = (key: TranslationKey) => string

const STATE_TONES: Readonly<Record<AdminGiftState, string>> = {
  ISSUED: 'chip--good',
  REDEEMED: 'chip--neutral',
  EXPIRED: 'chip--muted',
  VOID: 'chip--bad',
}

const giftPath = (item: AdminTimelineGift, t: Translate): string => {
  switch (item.state) {
    case 'REDEEMED': {
      const when = `${t('guestCard.gift.redeemed')} ${formatDateTime(item.redeemedAt)}`
      return item.redeemedReceiptId === null
        ? when
        : `${when}, ${t('guestCard.op.receipt')} ${item.redeemedReceiptId}`
    }
    case 'EXPIRED':
      return `${t('guestCard.gift.expired')} ${formatDate(item.expiresAt)}`
    case 'VOID':
      return t('guestCard.gift.void')
    case 'ISSUED':
      return `${t('guestCard.gift.until')} ${formatDate(item.expiresAt)}`
  }
}

export function TimelineGift({ item }: { item: AdminTimelineGift }): ReactElement {
  const t = useT()

  return (
    <li className="timeline__item">
      <span className="timeline__when">{formatDateTime(item.at)}</span>
      <div className="timeline__body">
        <p className="timeline__title">
          <span className={`chip ${STATE_TONES[item.state]}`}>{t('guestCard.gift')}</span>
          <span className="timeline__name">{item.title ?? t('guestCard.gift.untitled')}</span>
        </p>
        <p className="timeline__details">
          {`${t('guestCard.gift.issued')} → ${giftPath(item, t)} · `}
          <span className="data-table__mono">{`${t('guestCard.gift.code')} …${item.codeTail}`}</span>
        </p>
      </div>
      <span className="timeline__amount" aria-hidden="true" />
    </li>
  )
}
