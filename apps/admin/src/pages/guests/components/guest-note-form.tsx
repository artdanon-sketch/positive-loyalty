import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { GUEST_NOTE_MAX } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useSaveNote } from '../card-hooks'

/**
 * Заметка о госте. docs/02, раздел 5.2.4 · docs/11, U5.
 *
 * Заметка видна текстом прямо в карточке — «аллергия на арахис» нужно увидеть
 * сразу, а не открыв что-то. «Изменить» раскрывает поле; пустой текст стирает.
 * Под полем сказано, что гость заметку не видит: менеджер пишет её для коллег.
 */
export function GuestNoteForm({
  guestId,
  note,
}: {
  guestId: string
  note: string | null
}): ReactElement {
  const t = useT()
  const save = useSaveNote(guestId)

  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note ?? '')

  const tooLong = text.length > GUEST_NOTE_MAX

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (tooLong || save.isPending) {
      return
    }

    save.mutate(text, {
      onSuccess: () => {
        setEditing(false)
      },
    })
  }

  if (!editing) {
    return (
      <section className="guest-note" aria-labelledby="guest-note-title">
        <h3 className="guest-card__section" id="guest-note-title">
          {t('noteForm.title')}
        </h3>
        {note === null ? (
          <p className="field__hint">{t('noteForm.empty')}</p>
        ) : (
          <p className="guest-note__text">{note}</p>
        )}
        <button
          className="button"
          type="button"
          onClick={() => {
            save.reset()
            setText(note ?? '')
            setEditing(true)
          }}
        >
          {t(note === null ? 'noteForm.add' : 'noteForm.edit')}
        </button>
      </section>
    )
  }

  return (
    <form className="gift__form" aria-labelledby="guest-note-title" onSubmit={submit}>
      <h3 className="guest-card__section" id="guest-note-title">
        {t('noteForm.title')}
      </h3>

      <div className="field">
        <label className="field__label" htmlFor="guest-note-text">
          {t('noteForm.label')}
        </label>
        <textarea
          id="guest-note-text"
          className="field__input guest-note__input"
          rows={4}
          aria-invalid={tooLong}
          aria-describedby="guest-note-hint"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
          }}
        />
        <span
          className={tooLong ? 'field__hint field__hint--error' : 'field__hint'}
          id="guest-note-hint"
        >
          {t('noteForm.hint')} {text.length}/{GUEST_NOTE_MAX}
        </span>
      </div>

      {save.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {save.error.message}
        </p>
      ) : null}

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          onClick={() => {
            setEditing(false)
          }}
        >
          {t('noteForm.cancel')}
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={tooLong || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('noteForm.save')}
        </button>
      </div>
    </form>
  )
}
