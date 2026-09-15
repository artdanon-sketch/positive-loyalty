import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { GiftReason } from '@positive/contracts'

import { useCertificates } from '../../../shared/certificates/hooks'
import { fill } from '../../../shared/format/fill'
import { formatDate } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useIssueGift } from '../hooks'

/**
 * «Подарить» в карточке гостя. docs/10, раздел 5.2 · docs/11, У9.
 *
 * Три вопроса и кнопка: что дарим, за что, сколько действует. Частые подарки —
 * одним нажатием на подсказку. Причина обязательна: подарок стоит денег,
 * и через месяц владелец должен видеть, за что каждый.
 *
 * ИЛИ СЕРТИФИКАТ ИЗ ШАБЛОНА. Если в заведении заведены сертификаты, дарить можно
 * готовый: название и срок берутся из шаблона, поэтому поля «что дарим» и «действует»
 * уходят с экрана. Выключенные шаблоны в списке не показываются.
 *
 * ОДИН КЛЮЧ ПОВТОРА НА ОДНО НАМЕРЕНИЕ. Ключ создаётся вместе с формой и живёт,
 * пока подарок не выдан: если связь оборвётся и менеджер нажмёт ещё раз, уйдёт
 * тот же ключ, и второго десерта не будет. Выдан — следующий подарок получит
 * новый ключ.
 */

const PRESETS: readonly TranslationKey[] = [
  'gift.preset.dessert',
  'gift.preset.drink',
  'gift.preset.discount',
]

const REASONS: ReadonlyArray<{ value: GiftReason; label: TranslationKey }> = [
  { value: 'LONG_WAIT', label: 'gift.reason.LONG_WAIT' },
  { value: 'STAFF_ERROR', label: 'gift.reason.STAFF_ERROR' },
  { value: 'COMPLAINT', label: 'gift.reason.COMPLAINT' },
  { value: 'CELEBRATION', label: 'gift.reason.CELEBRATION' },
  { value: 'OTHER', label: 'gift.reason.OTHER' },
]

const DAYS = [7, 14, 30] as const

const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`

export function GiftForm({ guestId }: { guestId: string }): ReactElement {
  const t = useT()
  const gift = useIssueGift(guestId)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [certificateId, setCertificateId] = useState('')
  const [reason, setReason] = useState<GiftReason | null>(null)
  const [comment, setComment] = useState('')
  const [days, setDays] = useState<number>(14)
  const [key, setKey] = useState(newKey)

  // Шаблоны нужны только в открытой форме: карточку гостя открывают чаще, чем дарят.
  const certificates = useCertificates(open)
  const active = (certificates.data ?? []).filter((certificate) => certificate.isActive)
  const fromTemplate = certificateId !== ''

  const commentMissing = reason === 'OTHER' && comment.trim() === ''
  const ready = (fromTemplate || title.trim().length >= 2) && reason !== null && !commentMissing

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready || reason === null || gift.isPending) {
      return
    }

    const note = comment.trim() === '' ? {} : { comment: comment.trim() }

    gift.mutate(
      {
        key,
        input: fromTemplate
          ? { certificateId, reason, validityDays: days, ...note }
          : { title: title.trim(), reason, validityDays: days, ...note },
      },
      {
        onSuccess: () => {
          setKey(newKey())
          setTitle('')
          setCertificateId('')
          setReason(null)
          setComment('')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <section className="gift" aria-label={t('gift.title')}>
        {gift.isSuccess ? (
          <p className="gift__done" role="status">
            {fill(t('gift.done'), {
              title: gift.data.title,
              code: gift.data.codeTail,
              date: formatDate(gift.data.expiresAt),
            })}
          </p>
        ) : null}
        <button
          className="button button--primary gift__open"
          type="button"
          onClick={() => {
            gift.reset()
            setOpen(true)
          }}
        >
          {t('gift.open')}
        </button>
      </section>
    )
  }

  return (
    <form className="gift__form" aria-labelledby="gift-form-title" onSubmit={submit}>
      <h3 className="guest-card__section" id="gift-form-title">
        {t('gift.title')}
      </h3>

      {active.length === 0 ? null : (
        <div className="field">
          <label className="field__label" htmlFor="gift-certificate">
            {t('gift.certificate')}
          </label>
          <select
            id="gift-certificate"
            className="field__input"
            value={certificateId}
            aria-describedby={fromTemplate ? 'gift-certificate-hint' : undefined}
            onChange={(event) => {
              setCertificateId(event.target.value)
            }}
          >
            <option value="">{t('gift.certificateNone')}</option>
            {active.map((certificate) => (
              <option key={certificate.id} value={certificate.id}>
                {certificate.title}
              </option>
            ))}
          </select>
          {fromTemplate ? (
            <span className="field__hint" id="gift-certificate-hint">
              {t('gift.certificateHint')}
            </span>
          ) : null}
        </div>
      )}

      {fromTemplate ? null : (
        <div className="field">
          <label className="field__label" htmlFor="gift-what">
            {t('gift.what')}
          </label>
          <input
            id="gift-what"
            className="field__input"
            type="text"
            maxLength={80}
            autoComplete="off"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
          <div className="gift__presets">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                className="chip chip--neutral gift__preset"
                type="button"
                onClick={() => {
                  setTitle(t(preset))
                }}
              >
                {t(preset)}
              </button>
            ))}
          </div>
        </div>
      )}

      <fieldset className="term-form__group">
        <legend className="field__label">{t('gift.why')}</legend>
        <div className="choice">
          {REASONS.map((option) => (
            <button
              key={option.value}
              className={
                reason === option.value ? 'choice__option choice__option--on' : 'choice__option'
              }
              type="button"
              aria-pressed={reason === option.value}
              onClick={() => {
                setReason(option.value)
              }}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor="gift-comment">
          {t('gift.comment')}
        </label>
        <input
          id="gift-comment"
          className="field__input"
          type="text"
          maxLength={300}
          autoComplete="off"
          aria-invalid={commentMissing}
          aria-describedby="gift-comment-hint"
          value={comment}
          onChange={(event) => {
            setComment(event.target.value)
          }}
        />
        <span
          className={commentMissing ? 'field__hint field__hint--error' : 'field__hint'}
          id="gift-comment-hint"
        >
          {t('gift.commentHint')}
        </span>
      </div>

      {fromTemplate ? null : (
        <div className="field">
          <label className="field__label" htmlFor="gift-days">
            {t('gift.days')}
          </label>
          <select
            id="gift-days"
            className="field__input"
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value))
            }}
          >
            {DAYS.map((option) => (
              <option key={option} value={option}>
                {fill(t('gift.daysOption'), { n: option })}
              </option>
            ))}
          </select>
        </div>
      )}

      {gift.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {gift.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          onClick={() => {
            setOpen(false)
          }}
        >
          {t('gift.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={!ready || gift.isPending}
        >
          {gift.isPending ? t('common.saving') : t('gift.submit')}
        </button>
      </div>
    </form>
  )
}
