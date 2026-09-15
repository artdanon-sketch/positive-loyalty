import type { ReactElement } from 'react'
import { engineOfferTexts } from '@positive/contracts'

import { useLocale, useT } from '../../../shared/i18n'
import { draftLimits, draftReward } from '../draft'
import type { OfferDraft } from '../draft'

/**
 * Живое превью: так акцию увидит гость. docs/03, раздел 4.
 *
 * ТЕ ЖЕ ШАГИ, ЧТО НАПИШЕТ СЕРВЕР. Тексты считает общая функция из контрактов —
 * та самая, которой сервер заполнит акцию при запуске. Превью, собранное своими
 * словами, однажды разошлось бы с тем, что гость увидит в кошельке.
 *
 * Награда и лимиты считаются отдельно от расписания: превью обновляется, даже
 * пока владелец дописывает окно времени.
 */
export function GuestPreview({ draft }: { draft: OfferDraft }): ReactElement {
  const t = useT()
  const locale = useLocale()
  const reward = draftReward(draft)
  const limits = draftLimits(draft)
  const title = draft.title.trim()

  const steps =
    typeof reward === 'string' || typeof limits === 'string'
      ? []
      : (engineOfferTexts({ title, reward, limits }).howTo?.[locale] ?? [])

  return (
    <section className="constructor__preview" aria-labelledby="offer-preview-title">
      <h2 className="constructor__section" id="offer-preview-title">
        {t('offerNew.preview.title')}
      </h2>

      <div className="guest-preview">
        <div className="guest-preview__head">
          <b className="guest-preview__title">
            {title === '' ? t('offerNew.preview.untitled') : title}
          </b>
          <span className="guest-preview__venue">{t('offerNew.preview.venue')}</span>
        </div>

        {draft.type === 'PROMO_ON_CHECK' ? (
          <span className="guest-preview__code">{t('offerNew.preview.code')}</span>
        ) : null}

        {steps.length === 0 ? null : (
          <ol className="guest-preview__steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
