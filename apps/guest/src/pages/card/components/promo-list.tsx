import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'
import { giftValueText } from '../gift-value'
import { useClaimPromo, usePromos } from '../hooks'

/**
 * Промо-сертификаты на карте гостя: то, что он берёт сам. docs/02, раздел 5.11.
 *
 * ОТЛИЧИЕ ОТ «ЗА БАЛЛЫ» И ОТ «ВАШИХ ПОДАРКОВ». Витрина за баллы (RewardsList) —
 * это на что копить; «Ваши подарки» (VoucherList) — уже выданные промокоды.
 * Здесь — подарки, которые можно взять прямо сейчас и бесплатно: нажал
 * «Забрать» — промокод появился в «Ваших подарках».
 *
 * ПУСТО — БЛОКА НЕТ. Заведения без промо это не касается.
 *
 * ЗАБРАННОЕ НЕ ИСЧЕЗАЕТ, А ГАСНЕТ. Кнопка становится «Уже у вас»: гость видит,
 * что взял, и ищет промокод в «Ваших подарках», а не жмёт «Забрать» второй раз.
 *
 * СРОК И ОСТАТОК — ЕСЛИ ОНИ ЕСТЬ. «Забрать до 31.10» и «осталось 12» — честная
 * причина не откладывать; без срока и тиража этих строк нет.
 */
export function PromoList(): ReactElement | null {
  const t = useT()
  const promos = usePromos()
  const claim = useClaimPromo()

  if (promos.isPending || promos.isError || promos.data.length === 0) {
    return null
  }

  return (
    <section className="promo" aria-labelledby="promo-title">
      <h2 className="card__sectionTitle" id="promo-title">
        {t('promo.title')}
      </h2>
      <p className="promo__hint">{t('promo.hint')}</p>

      <ul className="promo__list">
        {promos.data.map((item) => {
          const busy = claim.isPending && claim.variables === item.offerId

          return (
            <li className="promo__item" key={item.offerId}>
              <div className="promo__main">
                <span className="promo__name">{item.title}</span>
                {/* Что именно получит гость: по названию это не всегда понятно. */}
                <span className="promo__value">{giftValueText(item.value, t)}</span>
                <span className="promo__venue">{item.venue}</span>
                <span className="promo__validity">
                  {t('promo.validityLead')} {item.validityDays}
                </span>
                {item.endsAt === null ? null : (
                  <span className="promo__validity">
                    {t('promo.endsAt').replace(
                      '{date}',
                      new Date(item.endsAt).toLocaleDateString(),
                    )}
                  </span>
                )}
                {item.left === null || item.claimed ? null : (
                  <span className="promo__validity">
                    {t('promo.left').replace('{count}', String(item.left))}
                  </span>
                )}
              </div>

              {item.claimed ? (
                <span className="promo__taken">{t('promo.claimed')}</span>
              ) : (
                <button
                  className="button button--primary promo__take"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    claim.mutate(item.offerId)
                  }}
                >
                  {busy ? t('promo.claiming') : t('promo.claim')}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {claim.isError ? (
        <p className="promo__error" role="alert">
          {t('promo.error')}
        </p>
      ) : null}
    </section>
  )
}
