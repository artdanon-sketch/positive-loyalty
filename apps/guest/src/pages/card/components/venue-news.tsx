import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'
import { useGuestNews, useMarkNewsSeen } from '../hooks'

/**
 * «Новости заведений» на карте гостя. docs/02, раздел 2.9 · docs/11, У13.
 *
 * ТРИ СВЕЖИЕ, ОСТАЛЬНЫЕ — ПО НАЖАТИЮ. Гость открыл карту у стойки ради кода; лента
 * не должна отодвигать заведения под скролл.
 *
 * Новостей нет или лента не загрузилась — блока нет: карта работает и без него.
 *
 * ПОКАЗАННОЕ ОТМЕЧАЕТСЯ УВИДЕННЫМ — владельцу в бэк-офисе видно, до скольких гостей
 * новость дошла. Отмечаются только те, что на экране: три свежие, а остальные —
 * когда гость раскроет ленту. Каждый идентификатор уходит один раз за сеанс,
 * повторы база всё равно не считает.
 */

const SHOWN = 3

/**
 * Отметить показанное увиденным. Отдельным хуком, потому что порядок хуков не должен
 * зависеть от того, есть ли новости: список пуст — просто нечего отмечать.
 */
function useSeen(ids: readonly string[]): void {
  const markSeen = useMarkNewsSeen()
  const sent = useRef(new Set<string>())
  const mark = markSeen.mutate
  const key = ids.join(',')

  useEffect(() => {
    const fresh = key.split(',').filter((id) => id !== '' && !sent.current.has(id))

    if (fresh.length === 0) {
      return
    }

    for (const id of fresh) {
      sent.current.add(id)
    }

    mark({ ids: fresh })
  }, [key, mark])
}

/** «2026-09-16T08:00:00.000Z» → «16.09». Год у свежих новостей очевиден. */
const shortDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

export function VenueNews(): ReactElement | null {
  const t = useT()
  const news = useGuestNews()
  const [expanded, setExpanded] = useState(false)
  const items = news.data?.items ?? []
  const visible = expanded ? items : items.slice(0, SHOWN)

  useSeen(visible.map((item) => item.id))

  if (items.length === 0) {
    return null
  }

  return (
    <section className="review" aria-labelledby="venue-news-title">
      <h2 className="card__sectionTitle" id="venue-news-title">
        {t('news.title')}
      </h2>
      <ul className="review__list">
        {visible.map((item) => (
          <li className="review__item" key={item.id}>
            <span className="review__venue">{`${item.venue} · ${shortDate(item.publishedAt)}`}</span>
            <p className="news__title">{item.title}</p>
            <p className="news__body">{item.body}</p>
          </li>
        ))}
      </ul>
      {expanded || items.length <= SHOWN ? null : (
        <button
          className="review__link"
          type="button"
          onClick={() => {
            setExpanded(true)
          }}
        >
          {t('news.more')}
        </button>
      )}
    </section>
  )
}
