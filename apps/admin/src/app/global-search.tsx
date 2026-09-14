import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'

import { useT } from '../shared/i18n'

/**
 * Поиск гостя из шапки — с любого экрана, на ноутбуке по ⌘K или Ctrl K.
 * docs/10, раздел 5.2: гость у стойки говорит «…4821», и владелец не должен
 * сначала вспоминать, на каком экране тут поиск.
 *
 * Сам поиск здесь не выполняется: строка уводит на экран гостей, где есть
 * и результаты, и карточка. Второго места с логикой поиска не появляется.
 */

const isApple = (): boolean => /Mac|iPhone|iPad/.test(navigator.userAgent)

export function GlobalSearch(): ReactElement {
  const t = useT()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const q = text.trim()

    if (q === '') {
      return
    }

    setText('')
    inputRef.current?.blur()
    void navigate(`/guests?q=${encodeURIComponent(q)}`)
  }

  return (
    <form className="global-search" role="search" aria-label={t('search.label')} onSubmit={submit}>
      <input
        ref={inputRef}
        className="global-search__input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      <kbd className="global-search__kbd" aria-hidden="true">
        {isApple() ? '⌘K' : 'Ctrl K'}
      </kbd>
    </form>
  )
}
