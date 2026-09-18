/**
 * Детерминированный набор демо-данных.
 *
 * CLAUDE.md, раздел «Демо-данные»: «Seed должен быть детерминированным: фиксированный
 * seed генератора, чтобы скриншоты и тесты не плыли». Здесь это выполнено жёстче, чем
 * просто зерно генератора: идентификаторы не выдаются базой, а собираются из индекса,
 * поэтому у одного и того же гостя один и тот же id на любой машине и в любом прогоне.
 * Отсюда же берётся идемпотентность seed — повторный запуск обновляет те же строки,
 * а не плодит новых гостей.
 *
 * Случайность в файле есть, но вся она проходит через `createRandom` с фиксированным
 * зерном. `Math.random()` в этом файле нет и быть не должно.
 *
 * ОДНО ИСКЛЮЧЕНИЕ ИЗ ДЕТЕРМИНИЗМА — даты истории визитов. Они отсчитываются
 * от дня запуска, потому что дашборд показывает последние 7, 30 и 90 дней
 * от сегодня: история, прибитая к фиксированной дате, через месяц уехала бы
 * за окно, и демо снова стало бы пустым. Суммы, идентификаторы, число визитов
 * и профиль дня от даты не зависят — на скриншотах пляшут только даты.
 *
 * Данные синтетические: телефоны выданы из заведомо свободного диапазона, имена
 * придуманы. Реальных персональных данных здесь нет и не появится.
 */

import { ProgramConfig, type Tier, type TierCondition } from '@positive/contracts'

/** Зерно генератора. Меняете его — меняются все скриншоты. */
const RANDOM_SEED = 0x504f5349

/** Версия набора. Входит в ключи идемпотентности seed: другой набор — другие ключи. */
export const SEED_VERSION = 'v2'

/**
 * Сколько гостей заводим. Двести — как в CLAUDE.md.
 *
 * Раньше здесь стояло сорок с оговоркой «полигон дорастёт вместе со схемой».
 * Схема доросла: у журнала появилось время события, и девяностодневная история
 * из того же CLAUDE.md стала выполнима. На сорока гостях график по дням выходил
 * решётом из пустых столбцов — по такому демо нельзя понять, как экран работает
 * на живом заведении.
 */
const GUEST_COUNT = 200

/** Доля туристов из CLAUDE.md: 60% туристы, 40% резиденты. */
const TOURIST_SHARE = 0.6

/**
 * Контрольная группа — 5% участий без начислений (CLAUDE.md). Берём каждое двадцатое,
 * а не «случайное с вероятностью 0.05»: доля обязана быть ровно той, что обещана
 * в отчёте по ROI, а не той, что выпала генератору.
 *
 * Сдвиг 7, а не 0, чтобы участие №0 — то самое, на котором работает демо-скрипт
 * продаж, — оказалось обычным. Гость из контрольной группы баллов не получает,
 * и демонстрация продаж на нём вышла бы неубедительной.
 */
const CONTROL_GROUP_EVERY = 20
const CONTROL_GROUP_OFFSET = 7

/** Точка отсчёта дат. Фиксированная: «сегодня» сделало бы seed недетерминированным. */
const BASE_DATE = new Date('2026-05-01T09:00:00.000Z')

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Шаг округления суммы чека: 5 бат. Чек «318,47» в тайской кассе не встречается. */
const RECEIPT_STEP_MINOR = 500

/**
 * Глубина истории. CLAUDE.md: «90 дней истории операций с реалистичной
 * сезонностью и провалом 14–17».
 *
 * Раньше эта строка была невыполнима: `LedgerService` не принимал дату события,
 * и вся история ложилась моментом запуска seed. Теперь у журнала есть
 * `occurredAt` — время СОБЫТИЯ отдельно от времени записи, — и девяносто дней
 * получаются честно, через ту же самую запись через сервис.
 */
const HISTORY_DAYS = 90

/**
 * Сколько визитов кладём одному участию.
 *
 * У туриста их мало по определению: он уезжает. Резидент ходит регулярно —
 * на нём и держится и график по дням, и «постоянный» статус в лестнице.
 */
const TOURIST_VISITS = [1, 3] as const
const RESIDENT_VISITS = [3, 10] as const

/**
 * Часовой профиль дня, доля визитов на каждый час 0–23.
 *
 * Провал 14–17 из CLAUDE.md сделан настоящим: после обеда зал пустеет,
 * вечером наполняется снова. Именно на этом профиле дашборд обязан выдать
 * совет «зал пустует с 14 до 17» — если совет не появится, значит либо
 * профиль, либо правило сломаны, и это видно глазами на демо.
 */
const HOUR_WEIGHTS = [
  0, 0, 0, 0, 0, 0, 1, 3, 6, 7, 9, 16, 18, 12, 3, 2, 3, 9, 16, 18, 14, 8, 3, 1,
] as const

/**
 * Недельная сезонность, множитель по дням недели с понедельника.
 *
 * Пятница и суббота на Пхукете заметно плотнее буднего вторника. Без этого
 * график по дням выходит ровной гребёнкой, по которой ничего не решишь.
 */
const WEEKDAY_WEIGHTS = [0.8, 0.75, 0.85, 1.0, 1.35, 1.5, 1.1] as const

/**
 * Смещение часового пояса заведений, часы.
 *
 * Все демо-заведения на Пхукете, `Tenant.timezone` у них по умолчанию
 * `Asia/Bangkok`. В Таиланде нет перехода на летнее время, поэтому смещение
 * постоянное и его можно держать числом, не таща в seed библиотеку поясов.
 * Нужно оно затем, что часы визита задаются МЕСТНЫЕ: обед в полдень должен
 * быть полднем у владельца, а не в UTC.
 */
const VENUE_UTC_OFFSET_HOURS = 7

// ─── Генератор ───────────────────────────────────────────────────────────────

/**
 * mulberry32 — маленький детерминированный PRNG.
 *
 * Взят намеренно простой: криптостойкость здесь не нужна, а нужна повторяемость на
 * любой версии node без внешних зависимостей.
 */
export const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Целое в диапазоне [min, max] включительно. */
const intBetween = (random: () => number, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1))

/**
 * UUID, собранный из индекса.
 *
 * Формат соблюдён по-настоящему: версия 4 и вариант 8 стоят на своих местах, поэтому
 * значение проходит `z.uuid()` в контрактах и ложится в колонку uuid без приведения.
 */
const uuidFromIndex = (group: string, index: number): string =>
  `${group}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`

// ─── Тенанты ─────────────────────────────────────────────────────────────────

/**
 * Настройки заведений берут тип и проверку из `@positive/contracts` — второй
 * декларации ProgramConfig в репозитории нет.
 *
 * Раньше здесь лежала своя копия типа, слово в слово повторяющая docs/01, раздел 4.3.
 * Копия разошлась с контрактом: seed писал `staffReward` и `ordering`, схема их
 * не знала, а `.strict()` отвергала — и касса отдавала 500 на предрасчёте вместо
 * начисления. Компилятор смолчать был обязан: два независимых объявления связать
 * нечем. Теперь объявление одно.
 *
 * `programConfig` ниже прогоняет литерал через саму схему на загрузке модуля:
 * типа мало, потому что в базу настройки едут как JSON, а из базы возвращаются
 * как `unknown`. Проверка на входе гарантирует, что записанное приложение прочитает.
 */
const programConfig = (settings: ProgramConfig): ProgramConfig => ProgramConfig.parse(settings)

export interface TenantSeed {
  readonly id: string
  readonly brandName: string
  readonly legalName: string
  readonly vertical: 'RESTAURANT' | 'SPA' | 'RENTAL'
  readonly locale: string
  readonly status: 'TRIAL' | 'ACTIVE'
  readonly plan: 'FREE' | 'PRO' | 'NETWORK'
  readonly seasonMode: boolean
  /** Типичный чек в сатангах: [минимум, максимум]. Целые, железное правило 4. */
  readonly receiptRangeMinor: readonly [number, number]
  readonly settings: ProgramConfig
}

const tier = (
  id: string,
  name: string,
  earnRate: number,
  redeemRate: number,
  conditions: TierCondition[],
): Tier => ({ id, name, earnRate, redeemRate, hidden: false, conditions })

/**
 * Витрина «что взять за баллы». docs/02, раздел 5.17.
 *
 * ДЕМО ДОЛЖНО ПОКАЗЫВАТЬ СМЫСЛ, А НЕ ТАБЛИЦУ. Поэтому у каждого заведения
 * есть и дешёвая награда, до которой доходит средний гость, и дорогая,
 * ради которой стоит копить, и позиция без цены в баллах — чтобы было видно,
 * что такие гостю не показываются.
 */
export interface CatalogItemSeed {
  readonly id: string
  readonly tenantId: string
  readonly name: string
  readonly description: string
  readonly priceMinor: number | null
  readonly pointsPrice: number | null
  readonly sortOrder: number
}

/**
 * Автосценарий рассылки. docs/02, раздел 5.4.1.
 *
 * Включён у одного заведения из трёх: так на демо видно и включённое
 * состояние, и выключенное по умолчанию.
 */
export interface AutomationSeed {
  readonly tenantId: string
  readonly kind: 'SLEEPING' | 'JOINED_NO_PURCHASE' | 'SPENT_TOTAL'
  readonly enabled: boolean
  readonly threshold: number
  readonly text: string
}

export const TENANTS: readonly TenantSeed[] = [
  {
    id: uuidFromIndex('10000000', 1),
    brandName: 'Kata Beach Kitchen',
    legalName: 'Kata Beach Kitchen Co., Ltd.',
    vertical: 'RESTAURANT',
    locale: 'th',
    status: 'ACTIVE',
    plan: 'PRO',
    seasonMode: false,
    receiptRangeMinor: [25_000, 180_000],
    settings: programConfig({
      mode: 'CASHBACK',
      baseEarnRate: 5,
      baseRedeemRate: 30,
      pointsExpireDays: 365,
      welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
      referral: { enabled: true, reward: 5_000, limit: 10 },
      birthday: {
        enabled: true,
        reward: { kind: 'POINTS', amount: 10_000 },
        daysBefore: 3,
        daysAfter: 3,
      },
      reviews: {
        autoReplies: [
          'Нам очень жаль. Напишите, что случилось, — разберёмся и исправим.',
          'Нам очень жаль. Напишите, что случилось, — разберёмся и исправим.',
          null,
          null,
          'Спасибо! Ждём вас снова.',
        ],
      },
      suspicious: { maxChecksPerDay: 5 },
      tiers: [
        tier('base', 'Гость', 5, 30, []),
        tier('regular', 'Постоянный', 7, 40, [{ type: 'VISITS_TOTAL', gt: 5 }]),
        tier('vip', 'VIP', 10, 50, [{ type: 'SPENT_TOTAL', gt: 1_500_000 }]),
      ],
      cashierRules: {
        requireReceiptNumber: true,
        maxManualAmount: 300_000,
        allowManualEntry: true,
        // У этого заведения теги на кассе включены: на полигоне должно быть
        // видно и включённое состояние, и выключенное по умолчанию у соседей.
        showGuestTags: true,
        allowTagging: true,
      },
      staffReward: {
        enabled: true,
        basis: 'PER_NEW_GUEST',
        value: 2_000,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      },
      ordering: { mode: 'EXTERNAL_LINK' },
    }),
  },
  {
    id: uuidFromIndex('10000000', 2),
    brandName: 'Sabai Thai Massage',
    legalName: 'Sabai Wellness Partnership',
    vertical: 'SPA',
    locale: 'th',
    status: 'ACTIVE',
    plan: 'FREE',
    seasonMode: true,
    receiptRangeMinor: [80_000, 350_000],
    settings: programConfig({
      mode: 'CASHBACK',
      baseEarnRate: 8,
      baseRedeemRate: 25,
      pointsExpireDays: 180,
      welcomeBonus: { enabled: true, amount: 10_000, trigger: 'ON_JOIN' },
      referral: { enabled: true, reward: 10_000, limit: 5 },
      birthday: {
        enabled: false,
        reward: { kind: 'POINTS', amount: 10_000 },
        daysBefore: 3,
        daysAfter: 3,
      },
      reviews: { autoReplies: [null, null, null, null, null] },
      suspicious: { maxChecksPerDay: 5 },
      tiers: [
        tier('base', 'Гость', 8, 25, []),
        tier('care', 'Забота', 12, 35, [{ type: 'VISITS_TOTAL', gt: 3 }]),
      ],
      cashierRules: {
        requireReceiptNumber: true,
        maxManualAmount: 500_000,
        allowManualEntry: true,
        showGuestTags: false,
        allowTagging: false,
      },
      staffReward: {
        enabled: true,
        basis: 'PCT_OF_REVENUE',
        value: 1,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 10,
      },
      ordering: { mode: 'OFF' },
    }),
  },
  {
    id: uuidFromIndex('10000000', 3),
    brandName: 'Phuket Ride',
    legalName: 'Phuket Ride Rental Co., Ltd.',
    vertical: 'RENTAL',
    locale: 'en',
    status: 'TRIAL',
    plan: 'FREE',
    seasonMode: false,
    receiptRangeMinor: [30_000, 120_000],
    settings: programConfig({
      mode: 'DISCOUNT',
      baseEarnRate: 4,
      baseRedeemRate: 20,
      pointsExpireDays: null,
      welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_JOIN' },
      referral: { enabled: false, reward: 0, limit: 10 },
      birthday: {
        enabled: false,
        reward: { kind: 'POINTS', amount: 10_000 },
        daysBefore: 3,
        daysAfter: 3,
      },
      reviews: { autoReplies: [null, null, null, null, null] },
      suspicious: { maxChecksPerDay: 5 },
      tiers: [tier('base', 'Гость', 4, 20, [])],
      cashierRules: {
        requireReceiptNumber: false,
        maxManualAmount: null,
        allowManualEntry: true,
        showGuestTags: false,
        allowTagging: false,
      },
      staffReward: {
        enabled: false,
        basis: 'PER_NEW_GUEST',
        value: 0,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      },
      ordering: { mode: 'OFF' },
    }),
  },
]

/** Тенант по id. Возвращает `undefined`, если id не из набора. */
export const findTenant = (tenantId: string): TenantSeed | undefined =>
  TENANTS.find((tenant) => tenant.id === tenantId)

// ─── Гости ───────────────────────────────────────────────────────────────────

export interface GuestSeed {
  readonly id: string
  readonly phoneE164: string
  readonly displayName: string
  readonly locale: string
  readonly mode: 'TOURIST' | 'RESIDENT'
  readonly createdAt: Date
  readonly lastSeenAt: Date
}

/** Имена придуманы. Совпадение с реальным человеком было бы случайностью. */
const TOURIST_NAMES: readonly string[] = [
  'Анна Ковалёва',
  'Дмитрий Орлов',
  'Emma Wilson',
  'James Carter',
  'Ольга Северова',
  'Sophie Turner',
  'Сергей Лаптев',
  'Liam Brooks',
  'Wei Li',
  'Мария Гончар',
  'Olivia Reed',
  'Fang Wang',
  'Иван Дорохов',
  'Noah Bennett',
  'Екатерина Мирная',
  'Min Zhang',
]

const RESIDENT_NAMES: readonly string[] = [
  'Somchai Preecha',
  'Nong Ploy',
  'Anan Sirikul',
  'Kanya Thongdee',
  'Chai Wattana',
  'Malee Kittisak',
  'Павел Резник',
  'Niran Chaiyo',
  'Sunee Rattana',
  'Артём Белов',
]

/** Языки интерфейса по режиму гостя: турист чаще приходит не с тайским телефоном. */
const TOURIST_LOCALES: readonly string[] = ['ru', 'en', 'zh']
const RESIDENT_LOCALES: readonly string[] = ['th', 'ru', 'en']

const pick = (values: readonly string[], index: number): string =>
  values[index % values.length] ?? ''

/**
 * Номер из диапазона +669 1000 0000 и выше. Формат тайского мобильного соблюдён
 * (E.164: 66 плюс девять цифр), сам диапазон реальным абонентам не выдан.
 */
const phoneFromIndex = (index: number): string => `+669${String(10_000_000 + index)}`

const daysBefore = (base: Date, days: number): Date => new Date(base.getTime() - days * MS_PER_DAY)

export const buildGuests = (): readonly GuestSeed[] => {
  const random = createRandom(RANDOM_SEED)
  const touristCount = Math.round(GUEST_COUNT * TOURIST_SHARE)
  const guests: GuestSeed[] = []

  for (let index = 0; index < GUEST_COUNT; index += 1) {
    const isTourist = index < touristCount
    const names = isTourist ? TOURIST_NAMES : RESIDENT_NAMES
    const locales = isTourist ? TOURIST_LOCALES : RESIDENT_LOCALES
    const nameIndex = isTourist ? index : index - touristCount

    // Турист попадает в базу недавно и быстро исчезает: у него короткая история.
    // Резидент живёт на острове — заведён давно и заходит регулярно.
    const ageDays = isTourist ? intBetween(random, 3, 90) : intBetween(random, 60, 400)
    const idleDays = isTourist ? intBetween(random, 0, 30) : intBetween(random, 0, 14)

    guests.push({
      id: uuidFromIndex('20000000', index),
      phoneE164: phoneFromIndex(index),
      displayName: pick(names, nameIndex),
      locale: pick(locales, nameIndex),
      mode: isTourist ? 'TOURIST' : 'RESIDENT',
      createdAt: daysBefore(BASE_DATE, ageDays),
      lastSeenAt: daysBefore(BASE_DATE, Math.min(idleDays, ageDays)),
    })
  }

  return guests
}

// ─── Участия ─────────────────────────────────────────────────────────────────

export interface MembershipSeed {
  readonly id: string
  readonly guestId: string
  readonly tenantId: string
  readonly source: 'ORGANIC' | 'CATALOG' | 'REFERRAL' | 'STAFF'
  readonly isControlGroup: boolean
}

const ACQUISITION_SOURCES: readonly MembershipSeed['source'][] = [
  'ORGANIC',
  'CATALOG',
  'REFERRAL',
  'STAFF',
]

const tenantAt = (index: number): TenantSeed => {
  const tenant = TENANTS[index % TENANTS.length]

  if (tenant === undefined) {
    // Недостижимо: TENANTS непустой. Проверка нужна из-за noUncheckedIndexedAccess
    // и заодно поймает случай, когда список тенантов однажды соберут динамически.
    throw new Error('Список тенантов пуст — демо-данные собрать не из чего')
  }

  return tenant
}

/**
 * Участия гостей в программах.
 *
 * Каждый гость состоит минимум в одной программе, каждый четвёртый — в двух: сквозной
 * телефон на всю платформу и есть тот сетевой эффект, ради которого `Guest` вынесен
 * из тенанта (docs/01, раздел 4.2).
 */
export const buildMemberships = (guests: readonly GuestSeed[]): readonly MembershipSeed[] => {
  const memberships: MembershipSeed[] = []

  const add = (guest: GuestSeed, tenant: TenantSeed): void => {
    const index = memberships.length

    memberships.push({
      id: uuidFromIndex('30000000', index),
      guestId: guest.id,
      tenantId: tenant.id,
      source: ACQUISITION_SOURCES[index % ACQUISITION_SOURCES.length] ?? 'ORGANIC',
      isControlGroup: index % CONTROL_GROUP_EVERY === CONTROL_GROUP_OFFSET,
    })
  }

  guests.forEach((guest, index) => {
    add(guest, tenantAt(index))

    if (index % 4 === 1) {
      add(guest, tenantAt(index + 1))
    }
  })

  return memberships
}

// ─── История визитов ─────────────────────────────────────────────────────────

export interface VisitSeed {
  readonly membershipId: string
  readonly tenantId: string
  /** Порядковый номер визита у этого участия, с единицы. */
  readonly ordinal: number
  /** Сумма чека в сатангах. Целое — железное правило 4. */
  readonly basisAmountMinor: number
  /** Сколько баллов начислить. У контрольной группы — ноль. */
  readonly pointsAmount: number
  readonly receiptId: string
  /** Ключ идемпотентности: стабилен между прогонами, поэтому seed повторяем. */
  readonly idempotencyKey: string
  /**
   * Когда визит ПРОИЗОШЁЛ. Уходит в `LedgerEntry.occurredAt`.
   *
   * Именно это поле делает историю историей: время записи у всех строк будет
   * одним — моментом прогона seed, — а время события растянуто на девяносто дней.
   */
  readonly occurredAt: Date
}

/**
 * Сколько баллов даёт чек.
 *
 * Округление вниз, а не «математическое»: округлять половину балла в пользу гостя
 * можно только по решению владельца, а не по умолчанию арифметики.
 *
 * В режиме CASHBACK один балл равен одному сатангу, поэтому и чек, и баллы живут
 * в одних и тех же минорных единицах.
 */
const pointsForReceipt = (basisAmountMinor: number, earnRatePercent: number): number =>
  Math.floor((basisAmountMinor * earnRatePercent) / 100)

/**
 * Выбор по весам: индекс выпадает тем чаще, чем больше его вес.
 *
 * Нужен и для часа дня, и для дня недели. Равномерный выбор дал бы ровную
 * гребёнку, на которой не видно ни обеденного пика, ни послеобеденного провала,
 * ради которых график и рисуется.
 */
const weightedIndex = (random: () => number, weights: readonly number[]): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let point = random() * total

  for (let index = 0; index < weights.length; index += 1) {
    point -= weights[index] ?? 0

    if (point <= 0) {
      return index
    }
  }

  return weights.length - 1
}

/**
 * Полночь сегодняшнего дня ПО ЧАСАМ ЗАВЕДЕНИЯ, выраженная как момент времени.
 *
 * От неё отсчитывается вся история. Дальше `Date.UTC` сам разбирается
 * с переносами через полночь и через месяц при отрицательных днях и часах.
 */
const venueMidnightToday = (): { year: number; month: number; day: number } => {
  const venueNow = new Date(Date.now() + VENUE_UTC_OFFSET_HOURS * 60 * 60 * 1000)

  return {
    year: venueNow.getUTCFullYear(),
    month: venueNow.getUTCMonth(),
    day: venueNow.getUTCDate(),
  }
}

/**
 * Отодвигает визит на сутки назад, если он попал в будущее.
 *
 * Так выходит у визитов «сегодня»: день выбран нулевым, а час взят из профиля
 * дня и может оказаться позже текущего — ужин в девять вечера, когда сейчас
 * пять. `LedgerService` такие записи отвергает, и правильно делает: чек не может
 * произойти позже, чем о нём узнали. На этом seed и упал в первый прогон.
 *
 * Сдвигаем на сутки, а не подрезаем час: подрезка сплющила бы все сегодняшние
 * визиты в один текущий час и оставила бы на графике по часам ложный пик.
 */
const notInFuture = (moment: Date): Date =>
  moment.getTime() > Date.now() ? new Date(moment.getTime() - MS_PER_DAY) : moment

/**
 * История покупок, которую seed проводит через `LedgerService`.
 *
 * Девяносто дней из CLAUDE.md здесь настоящие: у журнала есть `occurredAt` —
 * время события отдельно от времени записи, — и seed заполняет именно его,
 * продолжая писать через сервис. Обхода железного правила 1 не появилось:
 * баланс по-прежнему считает `LedgerService`, а не этот файл.
 *
 * ДАТЫ ЗАВИСЯТ ОТ ДНЯ ЗАПУСКА, и это осознанный размен. Дашборд показывает
 * последние 7, 30 и 90 дней от сегодня; история, прибитая к фиксированной дате,
 * через месяц уехала бы за окно, и демо снова стало бы пустым. Всё остальное
 * осталось детерминированным: идентификаторы, суммы, число визитов и профиль
 * дня зависят только от зерна, поэтому цифры на скриншотах не пляшут.
 */
export const buildVisits = (
  memberships: readonly MembershipSeed[],
  guests: readonly GuestSeed[],
): readonly VisitSeed[] => {
  const random = createRandom(RANDOM_SEED + 1)
  const visits: VisitSeed[] = []
  const modeOf = new Map(guests.map((guest) => [guest.id, guest.mode]))
  const anchor = venueMidnightToday()

  for (const membership of memberships) {
    const tenant = findTenant(membership.tenantId)

    if (tenant === undefined) {
      throw new Error(`Участие ${membership.id} ссылается на неизвестного тенанта`)
    }

    const [minVisits, maxVisits] =
      modeOf.get(membership.guestId) === 'RESIDENT' ? RESIDENT_VISITS : TOURIST_VISITS
    const visitCount = intBetween(random, minVisits, maxVisits)

    // Сначала выбираем дни, потом сортируем: порядковый номер визита обязан
    // совпадать с хронологией, иначе «второй визит» окажется раньше первого.
    const days = Array.from({ length: visitCount }, () => {
      const daysAgo = intBetween(random, 0, HISTORY_DAYS - 1)
      const weekday = new Date(
        Date.UTC(anchor.year, anchor.month, anchor.day - daysAgo),
      ).getUTCDay()
      // getUTCDay: воскресенье — 0. Таблица весов начинается с понедельника.
      const weight = WEEKDAY_WEIGHTS[(weekday + 6) % 7] ?? 1

      // Повторный бросок с вероятностью, обратной весу дня: так будни
      // прореживаются, а пятница с субботой остаются плотными.
      return random() > weight / Math.max(...WEEKDAY_WEIGHTS)
        ? intBetween(random, 0, HISTORY_DAYS - 1)
        : daysAgo
    }).sort((left, right) => right - left)

    for (const [index, daysAgo] of days.entries()) {
      const ordinal = index + 1
      const steps = intBetween(
        random,
        Math.ceil(tenant.receiptRangeMinor[0] / RECEIPT_STEP_MINOR),
        Math.floor(tenant.receiptRangeMinor[1] / RECEIPT_STEP_MINOR),
      )
      const basisAmountMinor = steps * RECEIPT_STEP_MINOR
      const hour = weightedIndex(random, HOUR_WEIGHTS)
      const minute = intBetween(random, 0, 59)

      visits.push({
        membershipId: membership.id,
        tenantId: membership.tenantId,
        ordinal,
        basisAmountMinor,
        pointsAmount: membership.isControlGroup
          ? 0
          : pointsForReceipt(basisAmountMinor, tenant.settings.baseEarnRate),
        receiptId: `SEED-${membership.id.slice(-6)}-${ordinal}`,
        idempotencyKey: `seed:${SEED_VERSION}:${membership.id}:${ordinal}`,
        // Час МЕСТНЫЙ, поэтому из него вычитается смещение заведения.
        occurredAt: notInFuture(
          new Date(
            Date.UTC(
              anchor.year,
              anchor.month,
              anchor.day - daysAgo,
              hour - VENUE_UTC_OFFSET_HOURS,
              minute,
            ),
          ),
        ),
      })
    }
  }

  return visits
}

// ─── Опорные точки для демо-скрипта продаж ───────────────────────────────────

/**
 * Участие, на котором работает `test-sales.ts`.
 *
 * Первое участие первого гостя в Kata Beach Kitchen: не в контрольной группе,
 * ресторан — вертикаль с самым понятным чеком. Id зафиксирован, а не выбран запросом
 * «первый попавшийся»: демо должно показывать одно и то же.
 */
export const DEMO_MEMBERSHIP_ID = uuidFromIndex('30000000', 0)
export const DEMO_GUEST_ID = uuidFromIndex('20000000', 0)
export const DEMO_TENANT_ID = uuidFromIndex('10000000', 1)

// ─── Сотрудники ──────────────────────────────────────────────────────────────
// CLAUDE.md: «по 4 сотрудника с разными ролями». Владелец, менеджер, два кассира.
//
// PIN'ы и коды устройств — демо-данные и печатаются seed'ом в консоль: без них
// в бэк-офис не войти, а искать их по исходникам владелец полигона не обязан.
// В настоящих средах сотрудников заводит владелец из бэк-офиса, PIN'ы не
// совпадают с демо и нигде не печатаются.

export interface StaffSeed {
  readonly id: string
  readonly tenantId: string
  readonly role: 'OWNER' | 'MANAGER' | 'CASHIER'
  readonly displayName: string
  /** Демо-PIN. Хеш считается на каждом запуске seed'а — scrypt с солью. */
  readonly pin: string
  /** Код устройства, с которого сотруднику разрешён вход. Глобально уникален. */
  readonly deviceId: string
  readonly deviceLabel: string
}

interface StaffTemplate {
  readonly role: StaffSeed['role']
  readonly name: string
  readonly pin: string
  readonly device: string
  readonly label: string
}

const STAFF_TEMPLATES: readonly StaffTemplate[] = [
  { role: 'OWNER', name: 'Владелец', pin: '7311', device: 'owner', label: 'Телефон владельца' },
  { role: 'MANAGER', name: 'Менеджер', pin: '4207', device: 'manager', label: 'Ноутбук менеджера' },
  {
    role: 'CASHIER',
    name: 'Кассир смены А',
    pin: '1984',
    device: 'pos-a',
    label: 'Планшет у кассы',
  },
  {
    role: 'CASHIER',
    name: 'Кассир смены Б',
    pin: '2648',
    device: 'pos-b',
    label: 'Планшет на террасе',
  },
]

const TENANT_SLUGS: Readonly<Record<string, string>> = {
  'Kata Beach Kitchen': 'kata',
  'Sabai Thai Massage': 'sabai',
  'Phuket Ride': 'ride',
}

/**
 * Виды продаж заведения: что именно оно продаёт гостю.
 *
 * НУЖНЫ ДЛЯ ПАРТНЁРСТВ. Условие «купил абонемент — получи ролл в подарок»
 * невозможно построить на одной сумме: ужин на 5 000 ฿ и абонемент на 5 000 ฿
 * для журнала неотличимы. Без справочника на полигоне головной пример docs/07
 * не на чем показать.
 *
 * Названия РАЗНЫЕ У РАЗНЫХ ВЕРТИКАЛЕЙ — в этом и смысл того, что список ведёт
 * заведение: у спа абонемент, у проката сутки и неделя, у ресторана зал
 * и доставка. Общий справочник на всех был бы бесполезен всем троим.
 *
 * Историческим операциям вид НЕ проставляется: они родились до справочника,
 * и NULL у них — правда, а не пробел. Заодно на полигоне видно, как система
 * ведёт себя с обеими разновидностями записей.
 */
export interface SaleKindSeed {
  readonly id: string
  readonly tenantId: string
  readonly name: string
  readonly sortOrder: number
}

const SALE_KIND_NAMES: Readonly<Record<'RESTAURANT' | 'SPA' | 'RENTAL', readonly string[]>> = {
  RESTAURANT: ['Ужин в зале', 'Доставка', 'Депозит на компанию'],
  SPA: ['Абонемент на 10 сеансов', 'Разовый сеанс', 'Подарочный сертификат'],
  RENTAL: ['Аренда на сутки', 'Аренда на неделю', 'Аренда на месяц'],
}

export const SALE_KINDS: readonly SaleKindSeed[] = TENANTS.flatMap((tenant, tenantIndex) =>
  SALE_KIND_NAMES[tenant.vertical].map((name, nameIndex) => ({
    id: uuidFromIndex('50000000', tenantIndex * 10 + nameIndex + 1),
    tenantId: tenant.id,
    name,
    sortOrder: nameIndex,
  })),
)

export const STAFF: readonly StaffSeed[] = TENANTS.flatMap((tenant, tenantIndex) => {
  const slug = TENANT_SLUGS[tenant.brandName] ?? `t${tenantIndex + 1}`

  return STAFF_TEMPLATES.map((template, templateIndex) => ({
    id: uuidFromIndex('40000000', tenantIndex * 10 + templateIndex + 1),
    tenantId: tenant.id,
    role: template.role,
    displayName: `${template.name} · ${tenant.brandName}`,
    pin: template.pin,
    deviceId: `demo-${slug}-${template.device}`,
    deviceLabel: template.label,
  }))
})

/** Витрины трёх заведений: по три позиции у каждого. */
export const CATALOG_ITEMS: readonly CatalogItemSeed[] = [
  {
    id: uuidFromIndex('c0000000', 1),
    tenantId: TENANTS[0]?.id ?? '',
    name: 'Кофе в подарок',
    description: 'Любой напиток из меню кофейной стойки.',
    priceMinor: 12_000,
    pointsPrice: 600,
    sortOrder: 0,
  },
  {
    id: uuidFromIndex('c0000000', 2),
    tenantId: TENANTS[0]?.id ?? '',
    name: 'Сет на двоих',
    description: 'Два основных блюда и десерт.',
    priceMinor: 180_000,
    pointsPrice: 9_000,
    sortOrder: 1,
  },
  {
    id: uuidFromIndex('c0000000', 3),
    tenantId: TENANTS[0]?.id ?? '',
    name: 'Паста дня',
    description: 'Позиция без цены в баллах: гость её в карте не увидит.',
    priceMinor: 32_000,
    pointsPrice: null,
    sortOrder: 2,
  },
  {
    id: uuidFromIndex('c0000000', 4),
    tenantId: TENANTS[1]?.id ?? '',
    name: 'Массаж стоп, 30 минут',
    description: 'Быстрое восстановление после пляжа.',
    priceMinor: 45_000,
    pointsPrice: 2_500,
    sortOrder: 0,
  },
  {
    id: uuidFromIndex('c0000000', 5),
    tenantId: TENANTS[1]?.id ?? '',
    name: 'Тайский массаж, час',
    description: 'Классика, ради которой копят.',
    priceMinor: 90_000,
    pointsPrice: 6_000,
    sortOrder: 1,
  },
  {
    id: uuidFromIndex('c0000000', 6),
    tenantId: TENANTS[2]?.id ?? '',
    name: 'День аренды скутера',
    description: 'Шлем и бензин включены.',
    priceMinor: 30_000,
    pointsPrice: 3_000,
    sortOrder: 0,
  },
]

/** Автосценарии: включён один, остальные показывают состояние по умолчанию. */
export const AUTOMATIONS: readonly AutomationSeed[] = [
  {
    tenantId: TENANTS[0]?.id ?? '',
    kind: 'SLEEPING',
    enabled: true,
    threshold: 30,
    text: 'Соскучились! Заходите — у нас для вас всё как вы любите.',
  },
  {
    tenantId: TENANTS[1]?.id ?? '',
    kind: 'JOINED_NO_PURCHASE',
    enabled: false,
    threshold: 7,
    text: 'Вы с нами, но ещё не заглядывали. Ждём вас.',
  },
]
