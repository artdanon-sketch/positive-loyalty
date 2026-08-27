import type { ReactElement } from 'react'
import type { LiveFeedEvent } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Живая лента начислений (docs/03, раздел 2).
 *
 * Имена приходят с сервера уже маскированными — «А***». Клиент их только
 * показывает: маскировать здесь было бы поздно, полное имя уже лежало бы
 * в разметке и в инструментах разработчика.
 *
 * Лента висит на экране в зале, поэтому в ней нет ни телефонов, ни балансов,
 * ни номеров чеков — только «кто-то на букву А получил столько-то».
 *
 * Пока не пришло ни одного события, блок показывает состояние ожидания,
 * а не пустоту: молчащая лента и сломанная лента выглядели бы одинаково.
 */
export function LiveFeed({
  events,
  isConnected,
}: {
  events: readonly LiveFeedEvent[]
  isConnected: boolean
}): ReactElement {
  const t = useT()

  return (
    <section className="feed" aria-label={t('overview.feed.title')}>
      <header className="feed__head">
        <h2 className="feed__title">{t('overview.feed.title')}</h2>
        <span className={`feed__state ${isConnected ? 'feed__state--live' : ''}`}>
          {isConnected ? t('overview.feed.live') : t('overview.feed.reconnecting')}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="feed__empty">{t('overview.feed.waiting')}</p>
      ) : (
        <ul className="feed__list">
          {/* `aria-live` на списке, а не на строке: диктору нужно сообщать
              о появлении новой записи, а не перечитывать всю ленту. */}
          {events.map((event) => (
            <li className="feed__item" key={event.id}>
              <span className="feed__who">
                {event.masked === '' ? t('overview.feed.anonymous') : event.masked}
              </span>
              <b className="feed__amount">+{formatBaht(event.amount)}</b>
              <span className="feed__basis">
                {event.basis === null ? '' : formatBaht(event.basis)}
              </span>
              <time className="feed__at" dateTime={event.at}>
                {formatTime(event.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** `2026-08-27T13:08:09.000Z` → `20:08` в часах читателя. */
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}
