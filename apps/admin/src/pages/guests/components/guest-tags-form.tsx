import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { GUEST_TAGS_MAX } from '@positive/contracts'
import type { Tag } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useCreateTag, useTags } from '../../../shared/tags/hooks'
import { useSetGuestTags } from '../card-hooks'

/**
 * Теги гостя. docs/02, раздел 5.2.5 · docs/11, У5.
 *
 * Отмеченное галочками сохраняется набором. Нужного тега нет — он заводится тут
 * же, не уходя из карточки: у стойки некогда ходить в настройки. Новый тег
 * сразу отмечается — ради него его и завели.
 */
export function GuestTagsForm({
  guestId,
  current,
}: {
  guestId: string
  current: readonly Tag[]
}): ReactElement {
  const t = useT()
  const tags = useTags()
  const setTags = useSetGuestTags(guestId)
  const create = useCreateTag()

  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>(current.map((tag) => tag.id))
  const [newName, setNewName] = useState('')

  const full = selected.length >= GUEST_TAGS_MAX

  const toggle = (id: string): void => {
    setSelected(
      selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id],
    )
  }

  const addTag = (): void => {
    const name = newName.trim()

    if (name === '' || create.isPending) {
      return
    }

    create.mutate(
      { name, color: 'slate' },
      {
        onSuccess: (tag) => {
          setNewName('')

          if (!full) {
            setSelected([...selected, tag.id])
          }
        },
      },
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (setTags.isPending) {
      return
    }

    setTags.mutate(selected, {
      onSuccess: () => {
        setEditing(false)
      },
    })
  }

  if (!editing) {
    return (
      <section className="guest-tags" aria-labelledby="guest-tags-title">
        <h3 className="guest-card__section" id="guest-tags-title">
          {t('tagsForm.title')}
        </h3>
        {current.length === 0 ? (
          <p className="field__hint">{t('tagsForm.empty')}</p>
        ) : (
          <ul className="guest-tags__list">
            {current.map((tag) => (
              <li key={tag.id} className={`chip tag-chip tag-chip--${tag.color}`}>
                {tag.name}
              </li>
            ))}
          </ul>
        )}
        <button
          className="button"
          type="button"
          onClick={() => {
            setTags.reset()
            create.reset()
            setSelected(current.map((tag) => tag.id))
            setEditing(true)
          }}
        >
          {t('tagsForm.edit')}
        </button>
      </section>
    )
  }

  return (
    <form className="gift__form" aria-labelledby="guest-tags-title" onSubmit={submit}>
      <h3 className="guest-card__section" id="guest-tags-title">
        {t('tagsForm.title')}
      </h3>

      {tags.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : tags.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {tags.error.message}
        </p>
      ) : (
        <fieldset className="term-form__group">
          <legend className="field__label">{t('tagsForm.pick')}</legend>
          {tags.data.length === 0 ? (
            <p className="field__hint">{t('tagsForm.noTags')}</p>
          ) : (
            <div className="guest-tags__pick">
              {tags.data.map((tag) => {
                const checked = selected.includes(tag.id)

                return (
                  <label key={tag.id} className="guest-tags__option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => {
                        toggle(tag.id)
                      }}
                    />
                    <span className={`chip tag-chip tag-chip--${tag.color}`}>{tag.name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
      )}

      <div className="form-row">
        <div className="field">
          <label className="field__label" htmlFor="guest-tags-new">
            {t('tagsForm.newLabel')}
          </label>
          <input
            id="guest-tags-new"
            className="field__input"
            type="text"
            maxLength={40}
            autoComplete="off"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value)
            }}
          />
        </div>
        <button
          className="button"
          type="button"
          disabled={newName.trim() === '' || create.isPending}
          onClick={addTag}
        >
          {t('tagsForm.create')}
        </button>
      </div>

      {create.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {create.error.message}
        </p>
      ) : null}
      {setTags.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {setTags.error.message}
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
          {t('tagsForm.cancel')}
        </button>
        <button className="button button--primary" type="submit" disabled={setTags.isPending}>
          {setTags.isPending ? t('common.saving') : t('tagsForm.save')}
        </button>
      </div>
    </form>
  )
}
