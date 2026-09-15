import type { ReactElement } from 'react'
import { RfmSegment } from '@positive/contracts'
import type { Tag, TierSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { hasFilters, SLEEPING_OPTIONS, SOURCES } from '../filters'
import type { GuestFilters } from '../filters'
import { RFM_LABELS } from '../../../shared/rfm/labels'
import { SOURCE_LABELS } from '../labels'

/**
 * Фильтры списка гостей. docs/03, раздел 3 · docs/11, У4.
 *
 * Выпадающие списки, а не десяток чипов: фильтров семь, у каждого несколько
 * значений, и строка чипов на телефоне уехала бы за край.
 *
 * Статус — только у владельца: лестница статусов лежит в настройках программы,
 * а они его. Менеджер фильтрует по остальному. Тег — у обоих: теги заводит
 * и менеджер. Нет ни статусов, ни тегов — нет и пустого списка.
 */

interface Option {
  readonly value: string
  readonly label: string
}

export function GuestFiltersBar({
  filters,
  tiers,
  tags,
  onChange,
}: {
  filters: GuestFilters
  tiers: TierSettings['tiers'] | null
  tags: readonly Tag[] | null
  onChange: (next: GuestFilters) => void
}): ReactElement {
  const t = useT()

  const select = (
    id: string,
    label: TranslationKey,
    value: string,
    options: readonly Option[],
    apply: (next: string) => void,
  ): ReactElement => (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t(label)}
      </label>
      <select
        id={id}
        className="field__input field__input--compact"
        value={value}
        onChange={(event) => {
          apply(event.target.value)
        }}
      >
        <option value="">{t('guests.filter.any')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )

  const sleepingValue = filters.sleeping === undefined ? '' : String(filters.sleeping)
  // Из пересланной ссылки может прийти «45 дней» — показываем его, а не молча «Все».
  const sleepingDays =
    filters.sleeping === undefined || SLEEPING_OPTIONS.includes(filters.sleeping)
      ? SLEEPING_OPTIONS
      : [...SLEEPING_OPTIONS, filters.sleeping]

  return (
    <div className="guest-filters" role="group" aria-label={t('guests.filter.label')}>
      {select(
        'guests-filter-mode',
        'guests.filter.mode',
        filters.mode ?? '',
        [
          { value: 'TOURIST', label: t('guests.mode.tourist') },
          { value: 'RESIDENT', label: t('guests.mode.resident') },
        ],
        (next) => {
          onChange({
            ...filters,
            mode: next === 'TOURIST' || next === 'RESIDENT' ? next : undefined,
          })
        },
      )}

      {tiers === null || tiers.length === 0
        ? null
        : select(
            'guests-filter-tier',
            'guests.filter.tier',
            filters.tier ?? '',
            tiers.map((tier) => ({ value: tier.id, label: tier.name })),
            (next) => {
              onChange({ ...filters, tier: next === '' ? undefined : next })
            },
          )}

      {tags === null || tags.length === 0
        ? null
        : select(
            'guests-filter-tag',
            'guests.filter.tag',
            filters.tag ?? '',
            tags.map((tag) => ({ value: tag.id, label: tag.name })),
            (next) => {
              onChange({ ...filters, tag: next === '' ? undefined : next })
            },
          )}

      {select(
        'guests-filter-segment',
        'guests.filter.segment',
        filters.segment ?? '',
        RfmSegment.options.map((segment) => ({ value: segment, label: t(RFM_LABELS[segment]) })),
        (next) => {
          onChange({ ...filters, segment: RfmSegment.options.find((segment) => segment === next) })
        },
      )}

      {select(
        'guests-filter-sleeping',
        'guests.filter.sleeping',
        sleepingValue,
        sleepingDays.map((days) => ({
          value: String(days),
          label: fill(t('guests.filter.sleepingDays'), { n: days }),
        })),
        (next) => {
          onChange({ ...filters, sleeping: next === '' ? undefined : Number(next) })
        },
      )}

      {select(
        'guests-filter-source',
        'guests.filter.source',
        filters.source ?? '',
        SOURCES.map((source) => ({ value: source, label: t(SOURCE_LABELS[source]) })),
        (next) => {
          onChange({ ...filters, source: SOURCES.find((source) => source === next) })
        },
      )}

      <label className="toggle guest-filters__toggle">
        <input
          type="checkbox"
          checked={filters.buyers === 'none'}
          onChange={(event) => {
            onChange({ ...filters, buyers: event.target.checked ? 'none' : undefined })
          }}
        />
        <span className="toggle__text">
          <b>{t('guests.filter.neverBought')}</b>
        </span>
      </label>

      {hasFilters(filters) ? (
        <button
          className="button"
          type="button"
          onClick={() => {
            onChange({})
          }}
        >
          {t('guests.filter.reset')}
        </button>
      ) : null}
    </div>
  )
}
