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
 * Данные синтетические: телефоны выданы из заведомо свободного диапазона, имена
 * придуманы. Реальных персональных данных здесь нет и не появится.
 */

/** Зерно генератора. Меняете его — меняются все скриншоты. */
const RANDOM_SEED = 0x504f5349

/** Версия набора. Входит в ключи идемпотентности seed: другой набор — другие ключи. */
export const SEED_VERSION = 'v1'

/** Сколько гостей заводим. Десятки, а не двести: полигон дорастёт вместе со схемой. */
const GUEST_COUNT = 40

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

/** Максимум визитов, которые seed кладёт в журнал одному участию. */
const MAX_SEEDED_VISITS = 3

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
 * ProgramConfig из docs/01, раздел 4.3.
 *
 * Объявлено через `type`, а не `interface`, и это не вкусовщина: у типа-алиаса
 * TypeScript выводит неявную индексную сигнатуру, и объект проходит в поле `Json`
 * Prisma без приведения. У интерфейса такой сигнатуры нет, и `settings` пришлось бы
 * кастовать — а каст в этом репозитории повод объясняться.
 */
type TierCondition =
  | { readonly type: 'SPENT_TOTAL'; readonly gt: number }
  | { readonly type: 'VISITS_TOTAL'; readonly gt: number }

type Tier = {
  readonly id: string
  readonly name: string
  readonly earnRate: number
  readonly redeemRate: number
  readonly hidden: boolean
  readonly conditions: readonly TierCondition[]
}

type ProgramConfig = {
  readonly mode: 'CASHBACK' | 'DISCOUNT'
  readonly baseEarnRate: number
  readonly baseRedeemRate: number
  readonly pointsExpireDays: number | null
  readonly welcomeBonus: {
    readonly enabled: boolean
    readonly amount: number
    readonly trigger: 'ON_JOIN' | 'ON_FIRST_PURCHASE'
  }
  readonly tiers: readonly Tier[]
  readonly cashierRules: {
    readonly requireReceiptNumber: boolean
    readonly maxManualAmount: number | null
    readonly allowManualEntry: boolean
  }
  readonly staffReward: {
    readonly enabled: boolean
    readonly basis: 'PER_NEW_GUEST' | 'PCT_OF_POINTS' | 'PCT_OF_REVENUE'
    readonly value: number
    readonly vesting: 'IMMEDIATE' | 'ON_SECOND_VISIT'
    readonly shiftCap: number
  }
  readonly ordering: {
    readonly mode: 'OFF' | 'EXTERNAL_LINK' | 'BUILTIN' | 'AGGREGATOR'
  }
}

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
  conditions: readonly TierCondition[],
): Tier => ({ id, name, earnRate, redeemRate, hidden: false, conditions })

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
    settings: {
      mode: 'CASHBACK',
      baseEarnRate: 5,
      baseRedeemRate: 30,
      pointsExpireDays: 365,
      welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
      tiers: [
        tier('base', 'Гость', 5, 30, []),
        tier('regular', 'Постоянный', 7, 40, [{ type: 'VISITS_TOTAL', gt: 5 }]),
        tier('vip', 'VIP', 10, 50, [{ type: 'SPENT_TOTAL', gt: 1_500_000 }]),
      ],
      cashierRules: {
        requireReceiptNumber: true,
        maxManualAmount: 300_000,
        allowManualEntry: true,
      },
      staffReward: {
        enabled: true,
        basis: 'PER_NEW_GUEST',
        value: 2_000,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      },
      ordering: { mode: 'EXTERNAL_LINK' },
    },
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
    settings: {
      mode: 'CASHBACK',
      baseEarnRate: 8,
      baseRedeemRate: 25,
      pointsExpireDays: 180,
      welcomeBonus: { enabled: true, amount: 10_000, trigger: 'ON_JOIN' },
      tiers: [
        tier('base', 'Гость', 8, 25, []),
        tier('care', 'Забота', 12, 35, [{ type: 'VISITS_TOTAL', gt: 3 }]),
      ],
      cashierRules: {
        requireReceiptNumber: true,
        maxManualAmount: 500_000,
        allowManualEntry: true,
      },
      staffReward: {
        enabled: true,
        basis: 'PCT_OF_REVENUE',
        value: 1,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 10,
      },
      ordering: { mode: 'OFF' },
    },
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
    settings: {
      mode: 'DISCOUNT',
      baseEarnRate: 4,
      baseRedeemRate: 20,
      pointsExpireDays: null,
      welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_JOIN' },
      tiers: [tier('base', 'Гость', 4, 20, [])],
      cashierRules: {
        requireReceiptNumber: false,
        maxManualAmount: null,
        allowManualEntry: true,
      },
      staffReward: {
        enabled: false,
        basis: 'PER_NEW_GUEST',
        value: 0,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      },
      ordering: { mode: 'OFF' },
    },
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
 * История покупок, которую seed проводит через `LedgerService`.
 *
 * Важное ограничение, о котором лучше знать заранее: даты у этих операций будут
 * сегодняшними. `LedgerService` не принимает `createdAt` — и правильно делает, задним
 * числом журнал не пишут. Девяностодневная история с сезонностью из CLAUDE.md требует
 * либо этой возможности, либо отдельного пути записи в обход сервиса; второе прямо
 * нарушает железное правило 1, поэтому история здесь короткая и «свежая».
 */
export const buildVisits = (memberships: readonly MembershipSeed[]): readonly VisitSeed[] => {
  const random = createRandom(RANDOM_SEED + 1)
  const visits: VisitSeed[] = []

  for (const membership of memberships) {
    const tenant = findTenant(membership.tenantId)

    if (tenant === undefined) {
      throw new Error(`Участие ${membership.id} ссылается на неизвестного тенанта`)
    }

    const [minReceipt, maxReceipt] = tenant.receiptRangeMinor
    const visitCount = intBetween(random, 0, MAX_SEEDED_VISITS)

    for (let ordinal = 1; ordinal <= visitCount; ordinal += 1) {
      const steps = intBetween(
        random,
        Math.ceil(minReceipt / RECEIPT_STEP_MINOR),
        Math.floor(maxReceipt / RECEIPT_STEP_MINOR),
      )
      const basisAmountMinor = steps * RECEIPT_STEP_MINOR

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
