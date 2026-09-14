import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PartnershipDetail, PartnershipMessageView } from '@positive/contracts'

import { formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useSendMessage } from '../hooks'

/**
 * Переписка двух заведений.
 *
 * Сообщения о предложенных, принятых и отклонённых условиях — строкой-событием,
 * а не пузырём: у них нет текста, их смысл — сам факт. Причина отказа, если
 * её написали, показывается рядом.
 *
 * Перевода пока нет (docs/07, раздел 7): сообщение показано на языке оригинала.
 */

const EVENT_LABELS: Readonly<Record<PartnershipMessageView['kind'], TranslationKey>> = {
  INVITE: 'chat.invite',
  TEXT: 'chat.invite',
  TERM_PROPOSED: 'chat.termProposed',
  TERM_ACCEPTED: 'chat.termAccepted',
  TERM_REJECTED: 'chat.termRejected',
  SYSTEM: 'chat.system',
}

export function PartnerChat({
  detail,
  isOwner,
}: {
  detail: PartnershipDetail
  isOwner: boolean
}): ReactElement {
  const t = useT()
  const send = useSendMessage(detail.id)
  const [text, setText] = useState('')

  const name = detail.partner.brandName ?? t('partner.fallbackName')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const message = text.trim()

    if (message === '' || send.isPending) {
      return
    }

    send.mutate(message, {
      onSuccess: () => {
        setText('')
      },
    })
  }

  return (
    <section className="panel" aria-labelledby="partner-chat-title">
      <h2 className="panel__title" id="partner-chat-title">
        {t('chat.title')}
      </h2>

      {detail.messages.length === 0 ? (
        <p className="state__hint">{t('chat.empty')}</p>
      ) : (
        <ol className="chat">
          {detail.messages.map((message) => {
            const who = message.fromUs ? t('chat.us') : name

            if (message.kind === 'INVITE' || message.kind === 'TEXT') {
              return (
                <li
                  key={message.id}
                  className={message.fromUs ? 'chat__message chat__message--ours' : 'chat__message'}
                >
                  <span className="chat__meta">
                    {who} · {formatDateTime(message.createdAt)}
                  </span>
                  <p className="chat__text">{message.text}</p>
                </li>
              )
            }

            return (
              <li key={message.id} className="chat__event">
                {`${who} — ${t(EVENT_LABELS[message.kind])}${message.text === '' ? '' : `: ${message.text}`} · ${formatDateTime(message.createdAt)}`}
              </li>
            )
          })}
        </ol>
      )}

      {!detail.actions.message ? (
        <p className="field__hint">{t('chat.closed')}</p>
      ) : isOwner ? (
        <form className="chat__form" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="partner-chat-input">
            {t('chat.placeholder')}
          </label>
          <textarea
            id="partner-chat-input"
            className="field__input chat__input"
            rows={2}
            maxLength={2000}
            placeholder={t('chat.placeholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
          <button
            className="button button--primary"
            type="submit"
            disabled={text.trim() === '' || send.isPending}
          >
            {t('chat.send')}
          </button>
          {send.isError ? (
            <p className="state__hint state__hint--error" role="alert">
              {send.error.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
