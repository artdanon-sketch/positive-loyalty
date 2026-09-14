import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useGuestCard } from '../hooks'
import { GuestSummary } from './guest-summary'
import { GuestTimeline } from './guest-timeline'

/**
 * Карточка гостя — выдвижная панель справа, а не отдельная страница
 * (docs/03, раздел 3): список остаётся на месте, и следующий гость у стойки —
 * в одном шаге.
 *
 * Ведёт себя как настоящий диалог: фокус переходит на «Закрыть», Esc закрывает,
 * после закрытия фокус возвращается туда, откуда карточку открыли, — человек
 * с клавиатуры не теряет место в таблице.
 */
export function GuestCard({
  guestId,
  onClose,
}: {
  guestId: string
  onClose: () => void
}): ReactElement {
  const t = useT()
  const card = useGuestCard(guestId)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Свежий обработчик без перезапуска эффекта: иначе каждая перерисовка
  // страницы заново отбирала бы фокус в пользу кнопки «Закрыть».
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  const title = card.isSuccess
    ? (card.data.displayName ?? t('guests.noName'))
    : t('guestCard.title')

  return (
    <div className="drawer">
      <div className="drawer__backdrop" aria-hidden="true" onClick={onClose} />
      <aside
        className="drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-card-title"
      >
        <header className="drawer__head">
          <h2 className="drawer__title" id="guest-card-title">
            {title}
          </h2>
          <button
            ref={closeRef}
            className="button drawer__close"
            type="button"
            aria-label={t('guestCard.close')}
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {card.isPending ? (
          <div className="state" role="status">
            <p className="state__title">{t('common.loading')}</p>
          </div>
        ) : card.isError ? (
          <div className="state state--error" role="alert">
            <p className="state__title">{t('common.error.title')}</p>
            <p className="state__hint">{card.error.message}</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void card.refetch()
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <>
            <GuestSummary card={card.data} />
            <GuestTimeline card={card.data} />
          </>
        )}
      </aside>
    </div>
  )
}
