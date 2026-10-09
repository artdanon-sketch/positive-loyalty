import type { ReactElement } from 'react'
import { GuestBirthdayWindow, GuestSort, RfmSegment } from '@positive/contracts'
import type { Tag, TierSettings } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { decodeRange, encodeRange, POINT_RANGES, SPENT_FROM, VISIT_RANGES } from '../filter-ranges'
import type { Range } from '../filter-ranges'
import { hasFilters, SLEEPING_OPTIONS, SOURCES } from '../filters'
import type { GuestFilters } from '../filters'
import { RFM_LABELS } from '../../../shared/rfm/labels'
import { SOURCE_LABELS } from '../labels'

/**
 * Фильтры списка гостей. docs/03, раздел 3 · docs/11, У4.
 *
 * Выпадающие списки, а не десяток чипов: фильтров больше десятка, у каждого
 * несколько значений, и строка чипов на телефоне уехала бы за край.
 *
 * Статус — только у владельца: лестница статусов лежит в настройках программы,
 * а они его. Менеджер фильтрует по остальному. Тег — у обоих: теги заводит
 * и менеджер. Нет ни статусов, ни тегов — нет и пустого списка.
 *
 * ПОРЯДОК — ПЕРВЫМ И БЕЗ «ВСЕ»: это не фильтр, а рейтинг. «Больше потратили»
 * превращает список в «Рейтинг клиентов» UDS, не убирая из него никого.
 */

interface Option {
  readonly value: string
  readonly label: string
}

const SORT_LABELS: Readonly<Record<GuestSort, TranslationKey>> = {
  recent: 'guests.sort.recent',
  spent: 'guests.sort.spent',
  visits: 'guests.sort.visits',
  points: 'guests.sort.points',
}

const BIRTHDAY_LABELS: Readonly<Record<GuestBirthdayWindow, TranslationKey>> = {
  today: 'guests.filter.birthday.today',
  week: 'guests.filter.birthday.week',
  month: 'guests.filter.birthday.month',
}

/** Готовые диапазоны плюс тот, что пришёл ссылкой, если его среди готовых нет. */
const withCurrent = (presets: readonly Range[], current: Range): readonly Range[] => {
  const value = encodeRange(current)

  return value === '' || presets.some((preset) => encodeRange(preset) === value)
    ? presets
    : [...presets, current]
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

  /** «от 5», «от 2 до 4», «до 0» — подпись диапазона; числа печатает `show`. */
  const rangeLabel = (range: Range, show: (value: number) => string): string => {
    if (range.from !== undefined && range.to !== undefined) {
      return range.from === range.to
        ? show(range.from)
        : fill(t('guests.filter.range.between'), { from: show(range.from), to: show(range.to) })
    }

    return range.from === undefined
      ? fill(t('guests.filter.range.to'), { to: show(range.to ?? 0) })
      : fill(t('guests.filter.range.from'), { from: show(range.from) })
  }

  const pointsLabel = (range: Range): string =>
    range.from === undefined && range.to === 0
      ? t('guests.filter.points.none')
      : range.from === 1 && range.to === undefined
        ? t('guests.filter.points.some')
        : rangeLabel(range, formatBaht)

  const visits: Range = { from: filters.visitsFrom, to: filters.visitsTo }
  const points: Range = { from: filters.pointsFrom, to: filters.pointsTo }
  const spentOptions =
    filters.spentFrom === undefined || SPENT_FROM.includes(filters.spentFrom)
      ? SPENT_FROM
      : [...SPENT_FROM, filters.spentFrom]

  const sleepingValue = filters.sleeping === undefined ? '' : String(filters.sleeping)
  // Из пересланной ссылки может прийти «45 дней» — показываем его, а не молча «Все».
  const sleepingDays =
    filters.sleeping === undefined || SLEEPING_OPTIONS.includes(filters.sleeping)
      ? SLEEPING_OPTIONS
      : [...SLEEPING_OPTIONS, filters.sleeping]

  return (
    <div className="guest-filters" role="group" aria-label={t('guests.filter.label')}>
      <div className="field">
        <label className="field__label" htmlFor="guests-sort">
          {t('guests.sort.label')}
        </label>
        <select
          id="guests-sort"
          className="field__input field__input--compact"
          value={filters.sort ?? 'recent'}
          onChange={(event) => {
            const sort = GuestSort.options.find((option) => option === event.target.value)
            onChange({ ...filters, sort: sort === 'recent' ? undefined : sort })
          }}
        >
          {GuestSort.options.map((option) => (
            <option key={option} value={option}>
              {t(SORT_LABELS[option])}
            </option>
          ))}
        </select>
      </div>

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
        'guests-filter-birthday',
        'guests.filter.birthday',
        filters.birthday ?? '',
        GuestBirthdayWindow.options.map((window) => ({
          value: window,
          label: t(BIRTHDAY_LABELS[window]),
        })),
        (next) => {
          onChange({
            ...filters,
            birthday: GuestBirthdayWindow.options.find((window) => window === next),
          })
        },
      )}

      {select(
        'guests-filter-visits',
        'guests.filter.visits',
        encodeRange(visits),
        withCurrent(VISIT_RANGES, visits).map((range) => ({
          value: encodeRange(range),
          label: rangeLabel(range, String),
        })),
        (next) => {
          const range = decodeRange(next)
          onChange({ ...filters, visitsFrom: range.from, visitsTo: range.to })
        },
      )}

      {select(
        'guests-filter-points',
        'guests.filter.points',
        encodeRange(points),
        withCurrent(POINT_RANGES, points).map((range) => ({
          value: encodeRange(range),
          label: pointsLabel(range),
        })),
        (next) => {
          const range = decodeRange(next)
          onChange({ ...filters, pointsFrom: range.from, pointsTo: range.to })
        },
      )}

      {select(
        'guests-filter-spent',
        'guests.filter.spent',
        filters.spentFrom === undefined ? '' : String(filters.spentFrom),
        spentOptions.map((amount) => ({
          value: String(amount),
          label: fill(t('guests.filter.range.from'), { from: formatBaht(amount) }),
        })),
        (next) => {
          onChange({ ...filters, spentFrom: next === '' ? undefined : Number(next) })
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
            // Порядок — не фильтр: «сбросить фильтры» рейтинг не ломает.
            onChange(filters.sort === undefined ? {} : { sort: filters.sort })
          }}
        >
          {t('guests.filter.reset')}
        </button>
      ) : null}
    </div>
  )
}
