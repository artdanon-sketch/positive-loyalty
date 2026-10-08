import { useState } from 'react'
import type { ReactElement } from 'react'
import type { BroadcastGift } from '@positive/contracts'

import { useCertificates } from '../../../shared/certificates/hooks'
import { fill } from '../../../shared/format/fill'
import { formatBaht, formatDate } from '../../../shared/format/format'
import { fromGiftDraft } from '../../../shared/gift/gift-draft'
import { GiftPicker } from '../../../shared/gift/gift-picker'
import { useT } from '../../../shared/i18n'
import {
  AUDIENCE_SEGMENTS,
  audienceOfSegment,
  charsLeft,
  draftIssues,
  emptyDraft,
} from '../broadcast-draft'
import type { BroadcastDraft } from '../broadcast-draft'
import { useBroadcastPreview, useBroadcasts, useCreateBroadcast } from '../broadcast-hooks'

/**
 * Вкладка «Рассылки» в «Общении». docs/03, раздел 5 · docs/02, раздел 5.4.
 *
 * СНАЧАЛА «КОМУ», ПОТОМ «ЧТО». Порядок не случайный: увидев «получат 19 из 31»,
 * владелец пишет другой текст, чем когда думает, что пишет всем.
 *
 * ЦИФРЫ ПРЕДПРОСМОТРА — ЧЕТЫРЕ, И КАЖДАЯ ОБЪЯСНЕНА. «Нашли 31, получат 19»
 * без остальных двух выглядит как ошибка системы, а не как наша забота о госте.
 *
 * АРХИВ РЯДОМ, А НЕ НА ОТДЕЛЬНОМ ЭКРАНЕ: перед новой рассылкой полезно увидеть,
 * что ушло в прошлый раз и чем кончилось.
 *
 * ПОДАРОК — ПОСЛЕ ТЕКСТА. Сначала владелец решает, что сказать, потом — чем
 * подкрепить. И сразу видит, кому достанется подарок: всем найденным, а не
 * только тем, кому дойдёт сообщение.
 */
export function BroadcastsView(): ReactElement {
  const t = useT()
  const [draft, setDraft] = useState<BroadcastDraft>(emptyDraft)
  const audience = audienceOfSegment(draft.segment)
  const preview = useBroadcastPreview(audience)
  const broadcasts = useBroadcasts()
  const create = useCreateBroadcast()

  const issues = draftIssues(draft, preview.data)
  const left = charsLeft(draft.text)
  const gift = fromGiftDraft(draft.gift)
  const certificates = useCertificates()

  /** Подарок одной строкой — для архива. */
  const describeGift = (value: BroadcastGift): string =>
    value.kind === 'POINTS'
      ? fill(t('campaignGift.describe.points'), { amount: formatBaht(value.amount) })
      : ((certificates.data ?? []).find((item) => item.id === value.certificateId)?.title ??
        t('campaignGift.kind.CERTIFICATE'))

  const send = (): void => {
    if (issues.length > 0 || create.isPending) {
      return
    }

    create.mutate(
      {
        title: draft.title.trim(),
        text: draft.text.trim(),
        audience,
        ...(gift.ok && gift.gift !== null ? { gift: gift.gift } : {}),
      },
      {
        onSuccess: () => {
          setDraft(emptyDraft())
        },
      },
    )
  }

  return (
    <>
      <section className="panel" aria-labelledby="broadcast-new">
        <h2 className="panel__title" id="broadcast-new">
          {t('broadcasts.new.title')}
        </h2>
        <p className="field__hint">{t('broadcasts.new.hint')}</p>

        <fieldset className="field">
          <legend className="field__label">{t('broadcasts.audience.label')}</legend>
          <div className="filter-chips" role="group">
            {AUDIENCE_SEGMENTS.map((segment) => (
              <button
                aria-pressed={draft.segment === segment.id}
                className={
                  draft.segment === segment.id
                    ? 'chip chip--good filter-chip'
                    : 'chip chip--neutral filter-chip'
                }
                key={segment.id}
                type="button"
                onClick={() => {
                  setDraft({ ...draft, segment: segment.id })
                }}
              >
                {t(segment.label)}
              </button>
            ))}
          </div>
        </fieldset>

        {preview.isPending ? (
          <p className="state__hint" role="status">
            {t('broadcasts.preview.counting')}
          </p>
        ) : preview.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {preview.error.message}
          </p>
        ) : (
          <dl className="broadcast-stats">
            <div className="broadcast-stats__item">
              <dt className="broadcast-stats__label">{t('broadcasts.preview.found')}</dt>
              <dd className="broadcast-stats__value">{preview.data.found}</dd>
            </div>
            <div className="broadcast-stats__item">
              <dt className="broadcast-stats__label">{t('broadcasts.preview.willReceive')}</dt>
              <dd className="broadcast-stats__value">{preview.data.willReceive}</dd>
            </div>
            <div className="broadcast-stats__item">
              <dt className="broadcast-stats__label">{t('broadcasts.preview.tired')}</dt>
              <dd className="broadcast-stats__value">{preview.data.tired}</dd>
            </div>
            <div className="broadcast-stats__item">
              <dt className="broadcast-stats__label">{t('broadcasts.preview.unreachable')}</dt>
              <dd className="broadcast-stats__value">{preview.data.unreachable}</dd>
            </div>
          </dl>
        )}

        <div className="field">
          <label className="field__label" htmlFor="broadcast-title">
            {t('broadcasts.field.title')}
          </label>
          <input
            className="field__input"
            id="broadcast-title"
            maxLength={120}
            type="text"
            value={draft.title}
            onChange={(event) => {
              setDraft({ ...draft, title: event.target.value })
            }}
          />
          <p className="field__hint">{t('broadcasts.field.titleHint')}</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="broadcast-text">
            {t('broadcasts.field.text')}
          </label>
          <textarea
            className="field__input review-card__textarea"
            id="broadcast-text"
            rows={4}
            value={draft.text}
            onChange={(event) => {
              setDraft({ ...draft, text: event.target.value })
            }}
          />
          <p className={left < 0 ? 'field__hint field__hint--error' : 'field__hint'}>
            {fill(t('broadcasts.field.left'), { count: String(left) })}
          </p>
        </div>

        <GiftPicker
          id="broadcast-gift"
          draft={draft.gift}
          problem={gift.ok ? null : gift.problem}
          onChange={(next) => {
            setDraft({ ...draft, gift: next })
          }}
        />
        {gift.ok && gift.gift !== null ? (
          <p className="field__hint">
            {fill(t('broadcasts.gift.hint'), { count: String(preview.data?.found ?? 0) })}
          </p>
        ) : null}

        {issues.length > 0 && draft.text.length > 0 ? (
          <ul className="state__hint">
            {issues.map((issue) => (
              <li key={issue}>{t(issue)}</li>
            ))}
          </ul>
        ) : null}

        {create.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {create.error.message}
          </p>
        ) : null}

        <button
          className="button button--primary"
          disabled={issues.length > 0 || create.isPending}
          type="button"
          onClick={send}
        >
          {create.isPending ? t('common.saving') : t('broadcasts.send')}
        </button>
      </section>

      <section className="panel" aria-labelledby="broadcast-archive">
        <h2 className="panel__title" id="broadcast-archive">
          {t('broadcasts.archive.title')}
        </h2>

        {broadcasts.isPending ? (
          <p className="state__hint" role="status">
            {t('common.loading')}
          </p>
        ) : broadcasts.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {broadcasts.error.message}
          </p>
        ) : broadcasts.data.items.length === 0 ? (
          <p className="state__hint">{t('broadcasts.archive.empty')}</p>
        ) : (
          <div className="review-list">
            {broadcasts.data.items.map((item) => (
              <article className="review-card" key={item.id}>
                <header className="review-card__head">
                  <h3 className="review-card__title">{item.title}</h3>
                  <span className="review-card__date">{formatDate(item.sendAt)}</span>
                </header>
                <p className="review-card__text">{item.text}</p>
                <p className="field__hint">
                  {fill(t('broadcasts.archive.result'), {
                    sent: String(item.sent),
                    total: String(item.total),
                    tired: String(item.tired),
                    unreachable: String(item.unreachable),
                  })}
                </p>
                {item.gift === null ? null : (
                  <p className="field__hint">
                    {fill(t('broadcasts.archive.gift'), {
                      gift: describeGift(item.gift),
                      gifted: String(item.gifted),
                    })}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
