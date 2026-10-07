import type { ReactElement } from 'react'
import type { PosMe } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { usePosMe } from '../hooks'
import { QueryFallback } from './query-fallback'

/**
 * Вкладка «Профиль»: кто я, где работаю и — если владелец открыл — как идёт смена.
 * docs/02, раздел 3.9.
 *
 * Показатели закрыты по умолчанию, и тогда их просто нет: без пустых строк
 * и без «попросите владельца» — кассиру не за что извиняться.
 */

const ROLE_LABEL: Readonly<Record<PosMe['role'], TranslationKey>> = {
  OWNER: 'role.owner',
  MANAGER: 'role.manager',
  CASHIER: 'role.cashier',
}

export function ProfileTab(): ReactElement {
  const t = useT()
  const me = usePosMe()

  if (me.data === undefined) {
    return <QueryFallback query={me} />
  }

  const { displayName, role, venue, stats } = me.data

  return (
    <div className="pos__step">
      <dl className="pos__summary">
        <div className="pos__row">
          <dt>{t('pos.profile.name')}</dt>
          <dd>{displayName}</dd>
        </div>
        <div className="pos__row">
          <dt>{t('pos.profile.role')}</dt>
          <dd>{t(ROLE_LABEL[role])}</dd>
        </div>
        <div className="pos__row">
          <dt>{t('pos.profile.venue')}</dt>
          <dd>{venue}</dd>
        </div>
      </dl>

      {stats === null ? null : (
        <dl className="pos__summary" aria-label={t('pos.profile.stats')}>
          <div className="pos__row pos__row--accent">
            <dt>{t('pos.profile.revenue')}</dt>
            <dd>{formatBaht(stats.shiftRevenue)}</dd>
          </div>
          <div className="pos__row">
            <dt>{t('pos.profile.checks')}</dt>
            <dd>{stats.shiftCount}</dd>
          </div>
          <div className="pos__row">
            <dt>{t('pos.profile.rating')}</dt>
            <dd>
              {stats.rating === null
                ? t('pos.profile.noRating')
                : fill(t('pos.profile.ratingValue'), { rating: stats.rating.toFixed(1) })}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
