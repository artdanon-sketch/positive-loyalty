import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n/i18n-context'
import { useSession } from '../../shared/session/session-context'
import { ThemeToggle } from '../../shared/theme/theme-toggle'
import { CardEmpty } from './components/card-empty'
import { CardError } from './components/card-error'
import { CardLoading } from './components/card-loading'
import { QrCode } from './components/qr-code'
import { useQrToken, useWallet } from './hooks'

/** 12 000 сатангов → «120,00 ฿». Хранение целое, форматирование на выводе. */
const formatBaht = (minor: number): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ฿`

/**
 * Карта гостя. docs/02, раздел 2.1 · прототип «гостевое приложение».
 *
 * Порядок блоков — от того, зачем экран открыли: сначала код для кассы,
 * потом баллы, потом список заведений. Гость открывает карту стоя у стойки,
 * и код должен быть под большим пальцем, а не под скроллом.
 */
export function Page(): ReactElement {
  const t = useT()
  const session = useSession()
  const wallet = useWallet()
  const qr = useQrToken()

  return (
    <main className="card">
      <header className="card__head">
        <div className="card__brand">
          <span className="card__mark" aria-hidden="true" />
          <span className="card__brandName">{t('card.brand')}</span>
        </div>
        <div className="card__headSide">
          <ThemeToggle />
          <button className="card__signout" type="button" onClick={session.signOut}>
            {t('card.signOut')}
          </button>
        </div>
      </header>

      {wallet.isPending ? (
        <CardLoading />
      ) : wallet.isError ? (
        <CardError
          message={wallet.error.message}
          onRetry={() => {
            void wallet.refetch()
          }}
        />
      ) : (
        <>
          <section className="card__points" aria-live="polite">
            <span className="card__pointsLabel">{t('card.points.label')}</span>
            <b className="card__pointsValue">{formatBaht(wallet.data.totalPoints)}</b>
            <span className="card__pointsHint">
              {wallet.data.memberships.length > 0
                ? `${t('card.points.venues')} ${wallet.data.memberships.length}`
                : t('card.points.none')}
            </span>
          </section>

          <section className="card__qr">
            <h2 className="card__sectionTitle">{t('card.qr.title')}</h2>
            {qr.isPending ? (
              <p className="card__qrHint">{t('card.qr.loading')}</p>
            ) : qr.isError ? (
              <p className="card__qrHint card__qrHint--error">{t('card.qr.error')}</p>
            ) : (
              <>
                <QrCode value={qr.data.token} label={t('card.qr.alt')} />
                <p className="card__qrHint">{t('card.qr.hint')}</p>
              </>
            )}
          </section>

          {wallet.data.memberships.length === 0 ? (
            <CardEmpty />
          ) : (
            <section className="card__venues">
              <h2 className="card__sectionTitle">{t('card.venues.title')}</h2>
              <ul className="venue-list">
                {wallet.data.memberships.map((membership) => (
                  <li className="venue" key={membership.tenantId}>
                    <div className="venue__main">
                      <b className="venue__name">{membership.brandName}</b>
                      <span className="venue__meta">
                        {membership.visitsTotal > 0
                          ? `${t('card.venues.visits')} ${membership.visitsTotal}`
                          : t('card.venues.firstVisit')}
                      </span>
                    </div>
                    <div className="venue__side">
                      <b className="venue__points">{formatBaht(membership.points)}</b>
                      {membership.isControlGroup ? (
                        <span className="venue__badge">{t('card.venues.control')}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
