import { RfmSegment } from '@positive/contracts'
import type { AdminGuestsQuery } from '@positive/contracts'

/**
 * Фильтры списка гостей в адресе страницы. docs/02, раздел 5.2 · docs/11, У4.
 *
 * ФИЛЬТРЫ ЖИВУТ В АДРЕСЕ, как и поиск: ссылку «спящие резиденты» можно переслать,
 * а перезагрузка не сбрасывает то, что владелец собрал.
 *
 * НЕИЗВЕСТНОЕ ИЗ АДРЕСА ОТБРАСЫВАЕТСЯ МОЛЧА. Ссылку с опечаткой сервер отверг бы
 * целиком, и человек увидел бы ошибку вместо списка — лучше список без одного
 * фильтра, чем пустой экран.
 */

export type GuestFilters = Pick<
  AdminGuestsQuery,
  'mode' | 'tier' | 'source' | 'sleeping' | 'buyers' | 'tag' | 'segment'
>

export type GuestSourceValue = NonNullable<GuestFilters['source']>

const MODES = ['TOURIST', 'RESIDENT'] as const

export const SOURCES: readonly GuestSourceValue[] = [
  'ORGANIC',
  'CATALOG',
  'REFERRAL',
  'STAFF',
  'IMPORT',
]

/** Сколько дней без визита предлагает экран. Из адреса принимается любое от недели до года. */
export const SLEEPING_OPTIONS: readonly number[] = [30, 60, 90]

const KEYS = ['mode', 'tier', 'source', 'sleeping', 'buyers', 'tag', 'segment'] as const

const TIER_ID = /^[a-z0-9-]{1,40}$/

/** Тег в адресе — его идентификатор, как его ждёт сервер (`z.uuid()`), а не название. */
const TAG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const filtersFromParams = (params: URLSearchParams): GuestFilters => {
  const mode = MODES.find((value) => value === params.get('mode'))
  const source = SOURCES.find((value) => value === params.get('source'))
  const tier = params.get('tier')
  const tag = params.get('tag')
  // Сегмент приходит из отчёта «RFM» ссылкой — и только из известных.
  const segment = RfmSegment.options.find((value) => value === params.get('segment'))
  const sleeping = Number(params.get('sleeping'))

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(tier === null || !TIER_ID.test(tier) ? {} : { tier }),
    ...(source === undefined ? {} : { source }),
    ...(Number.isInteger(sleeping) && sleeping >= 7 && sleeping <= 365 ? { sleeping } : {}),
    ...(params.get('buyers') === 'none' ? { buyers: 'none' as const } : {}),
    ...(tag === null || !TAG_ID.test(tag) ? {} : { tag }),
    ...(segment === undefined ? {} : { segment }),
  }
}

/** Записать фильтры в адрес: пустые убираются, поиск и открытая карточка не трогаются. */
export const writeFilters = (params: URLSearchParams, filters: GuestFilters): void => {
  for (const key of KEYS) {
    const value = filters[key]

    if (value === undefined) {
      params.delete(key)
    } else {
      params.set(key, String(value))
    }
  }
}

export const hasFilters = (filters: GuestFilters): boolean =>
  KEYS.some((key) => filters[key] !== undefined)

/** Пары для запроса — в постоянном порядке: ключ кэша не должен зависеть от порядка кликов. */
export const filterParams = (filters: GuestFilters): Array<[string, string]> =>
  KEYS.flatMap((key): Array<[string, string]> => {
    const value = filters[key]
    return value === undefined ? [] : [[key, String(value)]]
  })
