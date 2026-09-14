import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'

/**
 * Строка поиска гостя. Одна на всё: цифры телефона, имя, промокод, номер чека —
 * что именно набрали, разбирает сервер (docs/02, раздел 5.2).
 */
export function SearchBox({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}): ReactElement {
  const t = useT()

  return (
    <div className="search" role="search">
      <input
        className="field__input search__input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        aria-label={t('guests.search.label')}
        aria-describedby="guests-search-hint"
        placeholder={t('guests.search.placeholder')}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      <p className="search__hint" id="guests-search-hint">
        {t('guests.search.hint')}
      </p>
    </div>
  )
}
