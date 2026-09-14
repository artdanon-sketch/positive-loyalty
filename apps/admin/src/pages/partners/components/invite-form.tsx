import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { INVITE_TEXT_MIN } from '@positive/contracts'
import type { NetworkVenue } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { useInvite } from '../hooks'

/**
 * Приглашение к партнёрству.
 *
 * ТЕКСТ ПРЕДЗАПОЛНЕН (docs/07, раздел 6.2): первое сообщение незнакомому
 * заведению — самый высокий барьер, и шаблон его снимает. Владелец правит
 * его под себя, а не пишет с нуля.
 *
 * Сорок знаков — минимум сервера; счётчик показывает его заранее, чтобы
 * отказ не стал сюрпризом. Остальные отказы (квота, недавний отказ,
 * блокировка) сервер объясняет сам — текст ошибки показывается как есть.
 */
export function InviteForm({
  venue,
  onCancel,
}: {
  venue: NetworkVenue
  onCancel: () => void
}): ReactElement {
  const t = useT()
  const navigate = useNavigate()
  const invite = useInvite()
  const [text, setText] = useState(() => t('partners.invite.template'))

  const length = text.trim().length
  const short = length < INVITE_TEXT_MIN
  const fieldId = `invite-${venue.tenantId}`

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (short || invite.isPending) {
      return
    }

    invite.mutate(
      { partnerTenantId: venue.tenantId, text: text.trim() },
      {
        onSuccess: (result) => {
          void navigate(`/partners/${result.partnershipId}`)
        },
      },
    )
  }

  return (
    <form className="invite-form" onSubmit={submit}>
      <label className="field__label" htmlFor={fieldId}>
        {t('partners.invite.label')}
      </label>
      <textarea
        id={fieldId}
        className="field__input invite-form__text"
        rows={4}
        value={text}
        aria-describedby={`${fieldId}-hint`}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      <span
        className={short ? 'field__hint field__hint--error' : 'field__hint'}
        id={`${fieldId}-hint`}
      >
        {short
          ? fill(t('partners.invite.short'), { n: length, min: INVITE_TEXT_MIN })
          : fill(t('partners.invite.length'), { n: length })}
      </span>

      {invite.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {invite.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button className="button" type="button" onClick={onCancel}>
          {t('partners.invite.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={short || invite.isPending}
        >
          {invite.isPending ? t('common.saving') : t('partners.invite.send')}
        </button>
      </div>
    </form>
  )
}
