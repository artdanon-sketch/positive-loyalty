import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { SetupStep } from '@positive/contracts'

import { useAuth } from '../../../shared/auth/auth-context'
import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useToday } from '../hooks'

/**
 * «Сегодня» на главной. docs/03, раздел 2 · docs/11, У11.
 *
 * НАД ПЛИТКАМИ ПЕРИОДА. Владелец, открывший бэк-офис вечером, спрашивает «как прошёл
 * день», а не «как прошла неделя» — неделя ниже, с графиками.
 *
 * КАРТОЧКИ НАСТРОЙКИ — ТОЛЬКО НЕСДЕЛАННЫЕ И ТОЛЬКО ВЛАДЕЛЬЦУ. Сделанный шаг исчезает сам,
 * а менеджеру ссылки в настройки и команду ответили бы отказом — это разделы владельца.
 *
 * Не загрузилось — блок молчит: ниже дашборд со своим состоянием ошибки.
 */

const SETUP: Readonly<
  Record<
    SetupStep,
    { readonly to: string; readonly title: TranslationKey; readonly hint: TranslationKey }
  >
> = {
  PROGRAM: { to: '/settings', title: 'today.setup.PROGRAM', hint: 'today.setup.PROGRAM.hint' },
  CASHIER: { to: '/team', title: 'today.setup.CASHIER', hint: 'today.setup.CASHIER.hint' },
  OFFER: { to: '/offers/new', title: 'today.setup.OFFER', hint: 'today.setup.OFFER.hint' },
  CHANNEL: { to: '/settings', title: 'today.setup.CHANNEL', hint: 'today.setup.CHANNEL.hint' },
}

export function TodaySection(): ReactElement | null {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const today = useToday()

  if (!today.isSuccess) {
    return null
  }

  const data = today.data
  const pending = isOwner ? data.setup.filter((item) => !item.done) : []

  return (
    <>
      {pending.length === 0 ? null : (
        <section className="panel setup" aria-labelledby="setup-title">
          <h2 className="panel__title" id="setup-title">
            {t('today.setup.title')}
          </h2>
          <ul className="setup__list">
            {pending.map((item) => (
              <li key={item.step}>
                <Link className="setup__card" to={SETUP[item.step].to}>
                  <b className="setup__cardTitle">{t(SETUP[item.step].title)}</b>
                  <span className="setup__cardHint">{t(SETUP[item.step].hint)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="today" aria-labelledby="today-title">
        <h2 className="today__title" id="today-title">
          {t('today.title')}
        </h2>
        <div className="tiles">
          <article className="tile">
            <h3 className="tile__label">{t('today.revenue')}</h3>
            <b className="tile__value">{formatBaht(data.revenue)}</b>
            <p className="tile__meta">
              <span className="tile__hint">
                {fill(t('today.purchases'), { n: data.purchases })}
              </span>
              {data.avgCheck === null ? null : (
                <span className="tile__hint">
                  {fill(t('today.avgCheck'), { amount: formatBaht(data.avgCheck) })}
                </span>
              )}
            </p>
          </article>

          <article className="tile">
            <h3 className="tile__label">{t('today.buyers')}</h3>
            <b className="tile__value">{data.buyers}</b>
            <p className="tile__meta">
              <span className="tile__hint">
                {fill(t('today.newGuests'), { n: data.newGuests })}
              </span>
              <span className="tile__hint">
                {fill(t('today.totalGuests'), { n: data.totalGuests })}
              </span>
            </p>
          </article>

          <article className="tile">
            <h3 className="tile__label">{t('today.points')}</h3>
            <b className="tile__value">{formatBaht(data.pointsEarned)}</b>
            <p className="tile__meta">
              <span className="tile__hint">
                {fill(t('today.redeemed'), { amount: formatBaht(data.pointsRedeemed) })}
              </span>
              {data.voided === 0 ? null : (
                <span className="tile__hint">{fill(t('today.voided'), { n: data.voided })}</span>
              )}
            </p>
          </article>
        </div>
      </section>
    </>
  )
}
