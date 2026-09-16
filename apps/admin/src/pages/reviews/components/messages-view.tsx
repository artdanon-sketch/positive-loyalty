import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { GUEST_MESSAGE_REPLY_MAX } from '@positive/contracts'
import type { AdminGuestMessage, GuestMessageKind } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { MESSAGES_PAGE, NO_MESSAGE_FILTERS } from '../messages-filters'
import type { MessageFilters } from '../messages-filters'
import { useMessages, useReplyMessage } from '../messages-hooks'

/**
 * Вкладка «Жалобы и предложения» в «Общении». docs/03, раздел 8 · docs/02, раздел 5.15.
 *
 * ЖДУТ ОТВЕТА — НАД СПИСКОМ И ВСЕГДА ПО ЗАВЕДЕНИЮ ЦЕЛИКОМ: владелец, открывший
 * предложения, должен видеть, что где-то висят неотвеченные жалобы.
 *
 * ЖАЛОБЫ И ПРЕДЛОЖЕНИЯ РАЗДЕЛЕНЫ ФИЛЬТРОМ, А НЕ ВКЛАДКАМИ: их читают вперемешку,
 * а разбирают по одному — переключение вкладки ради трёх строк того не стоит.
 */

const KIND_LABELS: Readonly<Record<GuestMessageKind, TranslationKey>> = {
  COMPLAINT: 'messages.kind.COMPLAINT',
  SUGGESTION: 'messages.kind.SUGGESTION',
}

const KIND_OPTIONS: ReadonlyArray<{ value: GuestMessageKind | null; label: TranslationKey }> = [
  { value: null, label: 'messages.filter.allKinds' },
  { value: 'COMPLAINT', label: 'messages.kind.COMPLAINT' },
  { value: 'SUGGESTION', label: 'messages.kind.SUGGESTION' },
]

const ANSWERED_OPTIONS: ReadonlyArray<{ value: 'yes' | 'no' | null; label: TranslationKey }> = [
  { value: null, label: 'messages.filter.all' },
  { value: 'no', label: 'messages.filter.unanswered' },
  { value: 'yes', label: 'messages.filter.answered' },
]

export function MessagesView(): ReactElement {
  const t = useT()
  const [filters, setFilters] = useState<MessageFilters>(NO_MESSAGE_FILTERS)
  const [offset, setOffset] = useState(0)
  const messages = useMessages(filters, offset)

  // Новый фильтр — всегда с первой страницы: вторая страница жалоб не имеет отношения
  // ко второй странице всех обращений.
  const narrow = (next: MessageFilters): void => {
    setFilters(next)
    setOffset(0)
  }

  const chip = (on: boolean): string =>
    on ? 'chip chip--good filter-chip' : 'chip chip--neutral filter-chip'

  return (
    <section className="panel" aria-labelledby="messages-title">
      <h2 className="panel__title" id="messages-title">
        {t('messages.title')}
      </h2>
      <p className="field__hint">{t('messages.hint')}</p>

      <div className="guest-filters" role="group" aria-label={t('messages.filter.label')}>
        <div className="filter-chips">
          {KIND_OPTIONS.map((option) => (
            <button
              className={chip(filters.kind === option.value)}
              key={option.label}
              type="button"
              aria-pressed={filters.kind === option.value}
              onClick={() => {
                narrow({ ...filters, kind: option.value })
              }}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
        <div className="filter-chips">
          {ANSWERED_OPTIONS.map((option) => (
            <button
              className={chip(filters.answered === option.value)}
              key={option.label}
              type="button"
              aria-pressed={filters.answered === option.value}
              onClick={() => {
                narrow({ ...filters, answered: option.value })
              }}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      {messages.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : messages.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{messages.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void messages.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <p className="field__hint">
            {messages.data.unanswered === 0
              ? t('messages.allAnswered')
              : fill(t('messages.unanswered'), { n: messages.data.unanswered })}
          </p>

          {messages.data.items.length === 0 ? (
            <p className="state__hint">{t('messages.empty')}</p>
          ) : (
            <div className="review-list">
              {messages.data.items.map((item) => (
                <MessageCard key={item.id} message={item} />
              ))}
            </div>
          )}

          <div className="pager">
            {offset === 0 ? null : (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setOffset(Math.max(0, offset - MESSAGES_PAGE))
                }}
              >
                {t('messages.prev')}
              </button>
            )}
            {offset + MESSAGES_PAGE >= messages.data.total ? null : (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setOffset(offset + MESSAGES_PAGE)
                }}
              >
                {t('messages.next')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Обращение в списке. Поле ответа открыто сразу, если гостю ещё не ответили, —
 * владелец читает жалобу и тут же пишет, как в карточке отзыва.
 */
function MessageCard({ message }: { message: AdminGuestMessage }): ReactElement {
  const t = useT()
  const reply = useReplyMessage()
  const [editing, setEditing] = useState(message.reply === null)
  const [text, setText] = useState('')

  const trimmed = text.trim()
  const ready = trimmed !== '' && trimmed.length <= GUEST_MESSAGE_REPLY_MAX
  const titleId = `message-${message.id}`
  const fieldId = `message-reply-${message.id}`
  const name = message.guest.displayName ?? t('guests.noName')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || reply.isPending) {
      return
    }

    reply.mutate(
      { id: message.id, text: trimmed },
      {
        onSuccess: () => {
          setEditing(false)
          setText('')
        },
      },
    )
  }

  return (
    <article className="review-card" aria-labelledby={titleId}>
      <header className="review-card__head">
        <h3 className="review-card__title" id={titleId}>
          <span className={message.kind === 'COMPLAINT' ? 'chip chip--bad' : 'chip chip--neutral'}>
            {t(KIND_LABELS[message.kind])}
          </span>{' '}
          {message.guest.membershipId === null ? (
            <span className="review-card__guest">{name}</span>
          ) : (
            <Link className="review-card__guest" to={`/guests?guest=${message.guest.guestId}`}>
              {name}
            </Link>
          )}
        </h3>
        <time className="review-card__date" dateTime={message.createdAt}>
          {formatDateTime(message.createdAt)}
        </time>
      </header>

      {message.guest.phone === null ? null : (
        <p className="review-card__meta">{message.guest.phone}</p>
      )}

      <p className="review-card__comment">{message.text}</p>

      {message.reply !== null && !editing ? (
        <div className="review-card__reply">
          <span className="chip chip--good">{t('messages.replied')}</span>
          <p className="review-card__replyText">{message.reply}</p>
          <button
            className="link-button"
            type="button"
            onClick={() => {
              reply.reset()
              setText(message.reply ?? '')
              setEditing(true)
            }}
          >
            {t('messages.editReply')}
          </button>
        </div>
      ) : (
        <form className="review-card__form" onSubmit={submit}>
          <label className="field__label" htmlFor={fieldId}>
            {t('messages.replyLabel')}
          </label>
          <textarea
            id={fieldId}
            className="field__input review-card__textarea"
            rows={2}
            maxLength={GUEST_MESSAGE_REPLY_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
          {reply.isError ? (
            <p className="state__hint state__hint--error" role="alert">
              {reply.error.message}
            </p>
          ) : null}
          <div className="panel__actions">
            {message.reply === null ? null : (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setEditing(false)
                }}
              >
                {t('messages.cancel')}
              </button>
            )}
            <button className="button button--primary" type="submit" disabled={!ready}>
              {t('messages.send')}
            </button>
          </div>
        </form>
      )}
    </article>
  )
}
