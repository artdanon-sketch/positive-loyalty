import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PosGuest, PosTag } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useAddGuestTag } from '../hooks'

/**
 * Теги гостя на экране кассы. docs/03, раздел 4.
 *
 * ПОКАЗЫВАЕМ ТОЛЬКО ТО, ЧТО РАЗРЕШИЛ ВЛАДЕЛЕЦ. Пустой список тегов и пустой
 * справочник — обычное дело: настройка выключена, и касса об этом даже
 * не знает, ей просто нечего рисовать.
 *
 * ДОБАВЛЕНИЕ — ВЫБОРОМ ИЗ СПРАВОЧНИКА, без поля ввода. Кассир у стойки
 * печатает с ошибками, а тег с опечаткой не найдётся ни в одной выборке.
 */
export function GuestTags({
  guest,
  available,
}: {
  guest: PosGuest
  available: readonly PosTag[]
}): ReactElement | null {
  const t = useT()
  const add = useAddGuestTag()
  const [added, setAdded] = useState<readonly PosTag[]>([])

  // Гость из офлайн-очереди записан до появления тегов: там поля просто нет,
  // и падать из-за этого касса не имеет права.
  const tags = added.length > 0 ? added : (guest.tags ?? [])
  const rest = available.filter((tag) => !tags.some((item) => item.id === tag.id))

  if (tags.length === 0 && rest.length === 0) {
    return null
  }

  return (
    <div className="guest-tags">
      {tags.map((tag) => (
        <span className="chip chip--neutral" key={tag.id}>
          {tag.name}
        </span>
      ))}

      {rest.length === 0 ? null : (
        <select
          aria-label={t('pos.tags.add')}
          className="guest-tags__add"
          disabled={add.isPending}
          value=""
          onChange={(event) => {
            const tagId = event.target.value

            if (tagId === '') {
              return
            }

            add.mutate(
              { membershipId: guest.membershipId, tagId },
              {
                onSuccess: (next) => {
                  setAdded(next)
                },
              },
            )
          }}
        >
          <option value="">{t('pos.tags.add')}</option>
          {rest.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
