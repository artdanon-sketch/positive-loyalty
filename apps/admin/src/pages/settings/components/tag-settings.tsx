import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { TagColor } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useCreateTag, useDeleteTag, useTags } from '../../../shared/tags/hooks'

/**
 * Блок «Теги гостей» в настройках — справочник целиком. docs/02, раздел 5.2.5.
 *
 * Заводить теги можно и из карточки гостя; здесь — видеть все сразу и удалять
 * лишние. Удаление переспрашивает: тег сходит со всех гостей, и вернуть отметки
 * нельзя.
 */

const COLORS: ReadonlyArray<{ readonly value: TagColor; readonly label: TranslationKey }> = [
  { value: 'slate', label: 'tagSettings.color.slate' },
  { value: 'mint', label: 'tagSettings.color.mint' },
  { value: 'sky', label: 'tagSettings.color.sky' },
  { value: 'amber', label: 'tagSettings.color.amber' },
  { value: 'rose', label: 'tagSettings.color.rose' },
  { value: 'violet', label: 'tagSettings.color.violet' },
]

export function TagSettingsSection(): ReactElement {
  const t = useT()
  const tags = useTags()
  const create = useCreateTag()
  const remove = useDeleteTag()

  const [name, setName] = useState('')
  const [color, setColor] = useState<TagColor>('slate')
  const [confirming, setConfirming] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (name.trim() === '' || create.isPending) {
      return
    }

    create.mutate(
      { name: name.trim(), color },
      {
        onSuccess: () => {
          setName('')
        },
      },
    )
  }

  return (
    <section className="panel" aria-labelledby="tag-settings-title">
      <h2 className="panel__title" id="tag-settings-title">
        {t('tagSettings.title')}
      </h2>
      <p className="field__hint">{t('tagSettings.hint')}</p>

      {tags.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : tags.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {tags.error.message}
        </p>
      ) : tags.data.length === 0 ? (
        <p className="state__hint">{t('tagSettings.empty')}</p>
      ) : (
        <ul className="tag-list">
          {tags.data.map((tag) => (
            <li key={tag.id} className="tag-list__item">
              <span className={`chip tag-chip tag-chip--${tag.color}`}>{tag.name}</span>
              {confirming === tag.id ? (
                <span className="row-actions">
                  <span className="row-actions__warn">
                    {fill(t('tagSettings.confirm'), { name: tag.name })}
                  </span>
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate(tag.id, {
                        onSuccess: () => {
                          setConfirming(null)
                        },
                      })
                    }}
                  >
                    {t('tagSettings.deleteYes')}
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setConfirming(null)
                    }}
                  >
                    {t('tagSettings.cancel')}
                  </button>
                </span>
              ) : (
                <button
                  className="button button--danger"
                  type="button"
                  aria-label={fill(t('tagSettings.delete'), { name: tag.name })}
                  onClick={() => {
                    setConfirming(tag.id)
                  }}
                >
                  {t('tagSettings.deleteShort')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="form-row" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="tag-settings-name">
            {t('tagSettings.name')}
          </label>
          <input
            id="tag-settings-name"
            className="field__input"
            type="text"
            maxLength={40}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="tag-settings-color">
            {t('tagSettings.colorLabel')}
          </label>
          <select
            id="tag-settings-color"
            className="field__input"
            value={color}
            onChange={(event) => {
              setColor(
                COLORS.find((option) => option.value === event.target.value)?.value ?? 'slate',
              )
            }}
          >
            {COLORS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </div>
        <button
          className="button button--primary"
          type="submit"
          disabled={name.trim() === '' || create.isPending}
        >
          {t('tagSettings.create')}
        </button>
      </form>

      {create.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {create.error.message}
        </p>
      ) : null}
      {remove.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {t('tagSettings.deleteFailed')}
        </p>
      ) : null}
    </section>
  )
}
