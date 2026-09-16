import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { GUEST_MESSAGE_TEXT_MAX } from '@positive/contracts'
import type { GuestMessageKind, WalletMembership } from '@positive/contracts'

import { ApiError } from '../../../shared/api/api-client'
import type { TranslationKey } from '../../../shared/i18n/dictionaries'
import { useT } from '../../../shared/i18n/i18n-context'
import { useCreateGuestMessage, useGuestMessages } from '../hooks'

/**
 * «Написать заведению» на карте гостя. docs/02, раздел 2.10.
 *
 * СВЁРНУТО ДО НАЖАТИЯ. Гость открывает карту у стойки ради кода; форма на пол-экрана
 * отодвинула бы заведения вниз ради того, чем пользуются раз в месяц.
 *
 * ОТВЕТЫ — ТУТ ЖЕ, под формой: обращение без видимого ответа выглядит как письмо
 * в пустоту, и второй раз гость уже не напишет.
 *
 * ЗАВЕДЕНИЕ ВЫБИРАЕТ ГОСТЬ, в отличие от отзыва: обращение не привязано к визиту.
 * Заведений нет — блока нет: писать некому.
 */

const KIND_LABELS: Readonly<Record<GuestMessageKind, TranslationKey>> = {
  COMPLAINT: 'message.kind.COMPLAINT',
  SUGGESTION: 'message.kind.SUGGESTION',
}

const KINDS: readonly GuestMessageKind[] = ['COMPLAINT', 'SUGGESTION']

const ERRORS: Partial<Record<string, TranslationKey>> = {
  MESSAGE_LIMIT_REACHED: 'message.error.limit',
  VENUE_NOT_FOUND: 'message.error.venue',
}

export function VenueMessage({
  memberships,
}: {
  memberships: readonly WalletMembership[]
}): ReactElement | null {
  const t = useT()
  const messages = useGuestMessages()
  const send = useCreateGuestMessage()
  const [open, setOpen] = useState(false)
  const [tenantId, setTenantId] = useState('')
  const [kind, setKind] = useState<GuestMessageKind>('COMPLAINT')
  const [text, setText] = useState('')

  if (memberships.length === 0) {
    return null
  }

  const venue = tenantId === '' ? memberships[0]?.tenantId : tenantId
  const trimmed = text.trim()
  const ready = venue !== undefined && trimmed.length >= 2
  const answered = (messages.data?.items ?? []).filter((item) => item.reply !== null)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || send.isPending) {
      return
    }

    send.mutate(
      { tenantId: venue, kind, text: trimmed },
      {
        onSuccess: () => {
          setText('')
          setOpen(false)
        },
      },
    )
  }

  const errorKey = send.error instanceof ApiError ? ERRORS[send.error.code ?? ''] : undefined

  return (
    <section className="review" aria-labelledby="venue-message-title">
      <h2 className="card__sectionTitle" id="venue-message-title">
        {t('message.title')}
      </h2>

      {open ? (
        <form className="review__form" onSubmit={submit}>
          {memberships.length === 1 ? null : (
            <>
              <label className="review__label" htmlFor="message-venue">
                {t('message.venue')}
              </label>
              <select
                id="message-venue"
                className="review__input"
                value={venue}
                onChange={(event) => {
                  setTenantId(event.target.value)
                }}
              >
                {memberships.map((membership) => (
                  <option key={membership.tenantId} value={membership.tenantId}>
                    {membership.brandName}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="review__tags" role="group" aria-label={t('message.kindLabel')}>
            {KINDS.map((option) => (
              <button
                className={option === kind ? 'review__tag review__tag--on' : 'review__tag'}
                key={option}
                type="button"
                aria-pressed={option === kind}
                onClick={() => {
                  setKind(option)
                }}
              >
                {t(KIND_LABELS[option])}
              </button>
            ))}
          </div>

          <label className="review__label" htmlFor="message-text">
            {t('message.text')}
          </label>
          <textarea
            id="message-text"
            className="review__input"
            rows={3}
            maxLength={GUEST_MESSAGE_TEXT_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />

          {send.isError ? (
            <p className="review__error" role="alert">
              {errorKey === undefined ? send.error.message : t(errorKey)}
            </p>
          ) : null}

          <div className="review__actions">
            <button
              className="review__cancel"
              type="button"
              onClick={() => {
                setOpen(false)
              }}
            >
              {t('message.cancel')}
            </button>
            <button className="review__submit" type="submit" disabled={!ready || send.isPending}>
              {t('message.send')}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="review__link"
          type="button"
          onClick={() => {
            send.reset()
            setOpen(true)
          }}
        >
          {t('message.open')}
        </button>
      )}

      {answered.length === 0 ? null : (
        <ul className="review__list">
          {answered.slice(0, 3).map((item) => (
            <li className="review__item" key={item.id}>
              <span className="review__venue">
                {`${item.venue} · ${t(KIND_LABELS[item.kind])}`}
              </span>
              <p className="review__comment">{item.text}</p>
              <p className="review__reply">{item.reply}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
