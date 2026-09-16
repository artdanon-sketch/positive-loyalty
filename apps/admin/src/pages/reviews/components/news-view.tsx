import type { ReactElement } from 'react'

import { useAuth } from '../../../shared/auth/auth-context'
import { fill } from '../../../shared/format/fill'
import { formatDate } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useNews, useUpdateNews } from '../news-hooks'
import { NewsForm } from './news-form'

/**
 * Вкладка «Новости» в «Общении». docs/03, раздел 8 · docs/11, У13.
 *
 * Список с черновиками и опубликованными. Выпустить и снять с публикации — одной кнопкой
 * у владельца; менеджер видит то же без кнопок, запрет всё равно стоит на сервере.
 * Удаления нет: снятая новость остаётся черновиком.
 */
export function NewsView(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const news = useNews()
  const update = useUpdateNews()

  return (
    <>
      <section className="panel" aria-labelledby="news-title">
        <h2 className="panel__title" id="news-title">
          {t('news.title')}
        </h2>
        <p className="field__hint">{t('news.hint')}</p>

        {news.isPending ? (
          <p className="state__hint" role="status">
            {t('common.loading')}
          </p>
        ) : news.isError ? (
          <div role="alert">
            <p className="state__hint state__hint--error">{news.error.message}</p>
            <button
              className="button"
              type="button"
              onClick={() => {
                void news.refetch()
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : news.data.length === 0 ? (
          <p className="state__hint">{t('news.empty')}</p>
        ) : (
          <div className="review-list">
            {news.data.map((item) => (
              <article className="review-card" key={item.id} aria-labelledby={`news-${item.id}`}>
                <header className="review-card__head">
                  <h3 className="review-card__title" id={`news-${item.id}`}>
                    {item.title}
                  </h3>
                  <span className={item.isPublished ? 'chip chip--good' : 'chip chip--muted'}>
                    {t(item.isPublished ? 'news.status.published' : 'news.status.draft')}
                  </span>
                </header>
                {item.publishedAt === null ? null : (
                  <p className="review-card__meta">
                    {fill(t('news.publishedAt'), { date: formatDate(item.publishedAt) })}
                  </p>
                )}
                <p className="review-card__comment">{item.body}</p>
                {isOwner ? (
                  <div className="panel__actions">
                    <button
                      className="button"
                      type="button"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate({ id: item.id, input: { isPublished: !item.isPublished } })
                      }}
                    >
                      {t(item.isPublished ? 'news.unpublish' : 'news.publish')}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {update.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {update.error.message}
          </p>
        ) : null}
      </section>

      {isOwner ? <NewsForm /> : null}
    </>
  )
}
