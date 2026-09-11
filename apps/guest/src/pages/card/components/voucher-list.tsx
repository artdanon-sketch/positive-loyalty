import type { ReactElement } from 'react'
import type { WalletVoucher } from '@positive/contracts'

import { useT } from '../../../shared/i18n/i18n-context'

/**
 * Подарки гостя: промокоды, которые можно предъявить прямо сейчас.
 *
 * ГЛАВНОЕ НА ЭКРАНЕ — КОД. Гость стоит у стойки и показывает его кассиру,
 * поэтому код крупный, моноширинный и выделяется одним касанием. Всё
 * остальное — подпись к нему.
 *
 * СРОК ПОКАЗЫВАЕТСЯ ВСЕГДА, А НЕ ТОЛЬКО КОГДА ГОРИТ. Подарок без срока
 * выглядит вечным, и гость узнаёт правду у стойки — то есть в худший момент.
 * Сгорающие первыми идут сверху; порядок задаёт сервер.
 */

/** За сколько дней срок становится тревожным. */
const SOON_DAYS = 3

export function VoucherList({ vouchers }: { vouchers: readonly WalletVoucher[] }): ReactElement {
  const t = useT()

  return (
    <section className="card__vouchers" aria-labelledby="card-vouchers-title">
      <h2 className="card__sectionTitle" id="card-vouchers-title">
        {t('card.vouchers.title')}
      </h2>

      <ul className="voucher-list">
        {vouchers.map((voucher) => {
          // Срок посчитал сервер: часы телефона можно перевести, они врут
          // в роуминге и живут в чужом поясе, а спорить у стойки гость будет
          // с заведением, а не со своим телефоном.
          const left = voucher.expiresInDays

          return (
            <li className="voucher" key={voucher.grantId}>
              <div className="voucher__head">
                <b className="voucher__title">{voucher.title ?? t('card.vouchers.noTitle')}</b>
                <span className="voucher__venue">{voucher.venue}</span>
              </div>

              {/* Код — не текст, а предмет: его показывают, а не читают. */}
              <b className="voucher__code">{voucher.code}</b>

              <span
                className={`voucher__expiry${left <= SOON_DAYS ? ' voucher__expiry--soon' : ''}`}
              >
                {left <= 0 ? t('card.vouchers.lastDay') : `${t('card.vouchers.daysLeft')} ${left}`}
              </span>

              {voucher.howTo.length > 0 ? (
                <ol className="voucher__steps">
                  {voucher.howTo.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
