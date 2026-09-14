import type { ReactElement } from 'react'
import type { AdminTimelineOperation } from '@positive/contracts'

import { formatBaht, formatDateTime, formatSignedBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'

/**
 * Операция в истории гостя: что, по какому чеку, на какую сумму, что продали
 * и кто провёл. Отменённая остаётся на месте, приглушённой и с пометкой, —
 * рядом стоит её компенсация, и видно, что баллы не пропали, а вернулись.
 *
 * Нулевое начисление у гостя из контрольной группы объясняется словами:
 * владелец не должен гадать, почему за чек ничего не дали.
 */

const TYPE_LABELS: Readonly<Record<AdminTimelineOperation['type'], TranslationKey>> = {
  EARN: 'ops.type.earn',
  REDEEM: 'ops.type.redeem',
  REVERSAL: 'ops.type.reversal',
  EXPIRE: 'ops.type.expire',
  ADJUST: 'ops.type.adjust',
  GRANT: 'ops.type.grant',
}

const TYPE_TONES: Readonly<Record<AdminTimelineOperation['type'], string>> = {
  EARN: 'chip--good',
  REDEEM: 'chip--neutral',
  REVERSAL: 'chip--bad',
  EXPIRE: 'chip--neutral',
  ADJUST: 'chip--neutral',
  GRANT: 'chip--good',
}

export function TimelineOperation({
  item,
  controlGroup,
}: {
  item: AdminTimelineOperation
  controlGroup: boolean
}): ReactElement {
  const t = useT()

  const details = [
    item.receiptId === null ? null : `${t('guestCard.op.receipt')} ${item.receiptId}`,
    item.basisAmount === null ? null : formatBaht(item.basisAmount),
    item.saleKind,
    item.staffName,
  ].filter((part): part is string => part !== null)

  const tone = item.amount > 0 ? 'amount--in' : item.amount < 0 ? 'amount--out' : ''

  return (
    <li className={item.reversed ? 'timeline__item timeline__item--muted' : 'timeline__item'}>
      <span className="timeline__when">{formatDateTime(item.at)}</span>
      <div className="timeline__body">
        <p className="timeline__title">
          <span className={`chip ${TYPE_TONES[item.type]}`}>{t(TYPE_LABELS[item.type])}</span>
          {item.reversed ? (
            <span className="chip chip--bad">{t('guestCard.op.reversed')}</span>
          ) : null}
        </p>
        {details.length > 0 ? <p className="timeline__details">{details.join(' · ')}</p> : null}
        {item.type === 'EARN' && item.amount === 0 && controlGroup ? (
          <p className="timeline__why">{t('guestCard.op.zeroControl')}</p>
        ) : null}
      </div>
      <span className={`timeline__amount ${tone}`}>{formatSignedBaht(item.amount)}</span>
    </li>
  )
}
