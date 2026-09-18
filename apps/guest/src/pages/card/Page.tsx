import type { ReactElement } from 'react'

import { formatBaht } from '../../shared/format/baht'
import { useT } from '../../shared/i18n/i18n-context'
import { useSession } from '../../shared/session/session-context'
import { ThemeToggle } from '../../shared/theme/theme-toggle'
import { BirthdayPrompt } from './components/birthday-prompt'
import { CardEmpty } from './components/card-empty'
import { CardError } from './components/card-error'
import { CardLoading } from './components/card-loading'
import { InviteClaim } from './components/invite-claim'
import { QrCode } from './components/qr-code'
import { ReviewPrompt } from './components/review-prompt'
import { ReviewReplies } from './components/review-replies'
import { HistoryList } from './components/history-list'
import { InstallCard } from './components/install-card'
import { ProfileCard } from './components/profile-card'
import { RewardsList } from './components/rewards-list'
import { NotifyCard } from './components/notify-card'
import { VenueMessage } from './components/venue-message'
import { VenueNews } from './components/venue-news'
import { VenueInvite } from './components/venue-invite'
import { VenueBotInviteButton } from './components/venue-bot-invite'
import { VenueTier } from './components/venue-tier'
import { VoucherList } from './components/voucher-list'
import { useQrToken, useWallet } from './hooks'

/**
 * Карта гостя. docs/02, раздел 2.1 · прототип «гостевое приложение».
 *
 * Порядок блоков — от того, зачем экран открыли: сначала код для кассы,
 * потом баллы, потом список заведений. Гость открывает карту стоя у стойки,
 * и код должен быть под большим пальцем, а не под скроллом.
 *
 * Ответ на приглашение друга — над всем: гость пришёл по ссылке и ждёт
 * подтверждения, что ссылка сработала.
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

      <InviteClaim />

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

          {/* Подарки — ВЫШЕ списка заведений и сразу под кодом на кассе.
              Это то, ради чего гость открыл приложение у стойки: баллы он
              смотрит дома, а подарок предъявляет здесь и сейчас. */}
          {wallet.data.vouchers.length > 0 ? <VoucherList vouchers={wallet.data.vouchers} /> : null}

          {/* День рождения — после подарков: вопрос задаётся один раз и не должен
              отодвигать код для кассы. Без заведений спрашивать не о чем. */}
          {wallet.data.memberships.length > 0 ? <BirthdayPrompt /> : null}

          {/* Оценка визита и ответы заведений — ниже подарков и дня рождения:
              гость у стойки сначала показывает код, отзыв пишет потом. */}
          {wallet.data.memberships.length > 0 ? <ReviewPrompt /> : null}
          <ReviewReplies />
          <VenueNews />
          <VenueMessage memberships={wallet.data.memberships} />
          <RewardsList />
          <HistoryList />
          <ProfileCard />
          <InstallCard />
          <NotifyCard />

          {wallet.data.memberships.length === 0 ? (
            <CardEmpty />
          ) : (
            // aria-labelledby, а не просто section: у экрана два одинаковых
            // по структуре списка, и без имени они неразличимы ни для чтения
            // с экрана, ни для теста — заведение встречается и там, и там.
            <section className="card__venues" aria-labelledby="card-venues-title">
              <h2 className="card__sectionTitle" id="card-venues-title">
                {t('card.venues.title')}
              </h2>
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
                      <VenueTier membership={membership} />
                    </div>
                    <div className="venue__side">
                      <b className="venue__points">{formatBaht(membership.points)}</b>
                      {membership.isControlGroup ? (
                        <span className="venue__badge">{t('card.venues.control')}</span>
                      ) : null}
                    </div>
                    <VenueInvite membership={membership} />
                    <VenueBotInviteButton tenantId={membership.tenantId} />
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
