/**
 * Набор данных демо-заведения «POSitive Demo» — того, на котором владелец
 * платформы показывает систему людям. Запускает его `demo-venue.ts`.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ demo-data.ts. Тот наполняет ЛОКАЛЬНЫЙ полигон: три
 * заведения, пароли в исходнике, база пересоздаётся когда угодно. Этот набор
 * едет в БОЕВУЮ базу, рядом с настоящими заведениями, и отсюда три правила:
 *
 *   • ОДНО ЗАВЕДЕНИЕ И НИЧЕГО ВНЕ ЕГО. Всё тенантное создаётся с tenantId
 *     демо-заведения; гости — новые, с собственными id, чужих не трогаем.
 *   • НИ ОДНОГО ПАРОЛЯ. Репозиторий публичный: пароль из исходника открыл бы
 *     бэк-офис любому. Вход владельца задаёт сам владелец платформы командой
 *     `pnpm demo:venue --owner` — скрыто, как у `setup:business`.
 *   • ТЕЛЕФОНЫ, КОТОРЫХ НЕ БЫВАЕТ. Номера гостей — из диапазона, который
 *     британский регулятор Ofcom держит для кино и книг (+44 7700 900000–900999):
 *     ни одному абоненту его не выдают. Тайского аналога нет, а выдуманный
 *     «свободный» тайский номер однажды окажется чьим-то: телефон гостя
 *     уникален на всю платформу, и настоящий человек не смог бы его указать.
 *
 * ИСТОРИЯ ДОРАСТАЕТ ДО СЕГОДНЯ. Визиты считаются по календарным дням от начала
 * истории (за 90 дней до заведения демо) до текущей минуты, а случайность
 * каждого дня выводится из самого дня. Повторный запуск через неделю пройдёт
 * те же дни теми же ключами — журнал вернёт их повтором — и допишет новые.
 * Без этого через месяц графики «за 7 дней» на демо стояли бы пустыми.
 */
import { createHash } from 'node:crypto'

import {
  CreateOfferInput,
  engineOfferTexts,
  HumanCode,
  ProgramConfig,
  type OfferI18n,
  type ReviewTag,
} from '@positive/contracts'

import { createRandom, HOUR_WEIGHTS, WEEKDAY_WEIGHTS } from './demo-data.ts'

/** Версия набора. Входит в ключи журнала: другой набор — другие операции. */
const VERSION = 'v1'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Пхукет: UTC+7 круглый год, перехода на летнее время нет. */
const VENUE_OFFSET_MS = 7 * 60 * 60 * 1000

/** Глубина истории в день первого запуска. */
export const HISTORY_DAYS = 90

const GUEST_COUNT = 160

/** 60 % туристов, как на полигоне и как на Пхукете. */
const TOURIST_COUNT = 96

/** Каждое двадцатое участие — контрольная группа (CLAUDE.md, ровно 5 %). */
const CONTROL_GROUP_EVERY = 20
const CONTROL_GROUP_OFFSET = 13

/** Шаг суммы чека — 5 бат. */
const RECEIPT_STEP_MINOR = 500

// ─── Идентификаторы и случайность ────────────────────────────────────────────

const hashOf = (key: string): string =>
  createHash('sha256').update(`positive-demo:${key}`).digest('hex')

/**
 * UUID из смыслового ключа: у одного и того же гостя один и тот же id
 * при любом запуске. Версия 4 и вариант 8 на своих местах — значение проходит
 * `z.uuid()` контрактов.
 */
export const demoUuid = (key: string): string => {
  const hex = hashOf(key)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Идентификатор демо-заведения — UUID, а не слово вроде `positive-demo`:
 * журнал проверяет, что `tenantId` операции — UUID, и на слове отказывает
 * в каждом начислении.
 */
export const DEMO_TENANT_ID = demoUuid('tenant')
export const DEMO_BRAND_NAME = 'POSitive Demo'

/** Генератор, чьё зерно — сам ключ. День гостя не зависит от других дней. */
const randomFor = (key: string): (() => number) =>
  createRandom(Number.parseInt(hashOf(key).slice(0, 8), 16))

const intBetween = (random: () => number, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1))

const weightedIndex = (random: () => number, weights: readonly number[]): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let point = random() * total

  for (let index = 0; index < weights.length; index += 1) {
    point -= weights[index] ?? 0
    if (point <= 0) return index
  }

  return weights.length - 1
}

const pick = <T>(values: readonly T[], index: number): T => {
  const value = values[index % values.length]
  if (value === undefined) throw new Error('Пустой список в демо-наборе')
  return value
}

// ─── Календарь заведения ─────────────────────────────────────────────────────

/** Номер дня по часам заведения: полночь на Пхукете, а не в Гринвиче. */
export const venueDay = (moment: Date): number =>
  Math.floor((moment.getTime() + VENUE_OFFSET_MS) / MS_PER_DAY)

const dayKey = (day: number): string => new Date(day * MS_PER_DAY).toISOString().slice(0, 10)

/** Момент «день, час:минута по Пхукету». */
const venueMoment = (day: number, hour: number, minute: number): Date =>
  new Date(day * MS_PER_DAY - VENUE_OFFSET_MS + (hour * 60 + minute) * 60 * 1000)

/** 0 — понедельник: таблица весов начинается с него. */
const weekdayOf = (day: number): number => (new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7

// ─── Заведение ───────────────────────────────────────────────────────────────

/** Настройки — через схему контракта: записанное приложение обязано прочитать. */
export const DEMO_SETTINGS: ProgramConfig = ProgramConfig.parse({
  mode: 'CASHBACK',
  baseEarnRate: 5,
  baseRedeemRate: 30,
  pointsExpireDays: 365,
  welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
  // Три круга включены: на демо их и показывают.
  referral: { enabled: true, reward: 5_000, limit: 10, levels: [5, 3, 1] },
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
    { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 30, hidden: false, conditions: [] },
    {
      id: 'regular',
      name: 'Постоянный',
      earnRate: 7,
      redeemRate: 40,
      hidden: false,
      conditions: [{ type: 'VISITS_TOTAL', gt: 5 }],
    },
    {
      id: 'vip',
      name: 'VIP',
      earnRate: 10,
      redeemRate: 50,
      hidden: false,
      conditions: [{ type: 'SPENT_TOTAL', gt: 1_500_000 }],
    },
  ],
  cashierRules: {
    requireReceiptNumber: false,
    maxManualAmount: 300_000,
    allowManualEntry: true,
    showGuestTags: true,
    allowTagging: true,
    showOwnHistory: true,
    showOwnStats: true,
    allowInvite: true,
  },
  staffReward: {
    enabled: true,
    basis: 'PER_NEW_GUEST',
    value: 2_000,
    vesting: 'ON_SECOND_VISIT',
    shiftCap: 15,
  },
  ordering: { mode: 'OFF' },
  // Раздел «О заведении»: лежит в тех же настройках ключом profile.
  profile: {
    about: 'Кафе у пляжа Ката: завтраки, паста и кофе с собой. Демо-заведение POSitive.',
    phone: null,
    website: null,
    address: 'Kata Beach, Phuket',
    hours: '08:00–22:00',
  },
})

// ─── Справочники ─────────────────────────────────────────────────────────────

export interface DemoCashier {
  readonly id: string
  readonly displayName: string
}

/**
 * Кассиры — только для подписи операций: кто пробил чек, видно в отчёте
 * по сотрудникам и в «Безопасности». Входа у них нет: PIN не задан,
 * устройство не привязано. Нужен вход кассира — владелец задаёт PIN
 * в «Команде», как у настоящего заведения.
 */
export const DEMO_CASHIERS: readonly [DemoCashier, DemoCashier] = [
  { id: demoUuid('staff:noi'), displayName: 'Ной — утренняя смена' },
  { id: demoUuid('staff:may'), displayName: 'Мэй — вечерняя смена' },
]

export interface DemoNamed {
  readonly id: string
  readonly name: string
}

export const DEMO_SALE_KINDS: readonly DemoNamed[] = [
  { id: demoUuid('sale-kind:hall'), name: 'В зале' },
  { id: demoUuid('sale-kind:delivery'), name: 'Доставка' },
  { id: demoUuid('sale-kind:takeaway'), name: 'С собой' },
]

export interface DemoCatalogItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly priceMinor: number
  readonly pointsPrice: number | null
}

/** Дешёвая награда, дорогая и позиция без цены в баллах — как на полигоне. */
export const DEMO_CATALOG: readonly DemoCatalogItem[] = [
  {
    id: demoUuid('catalog:coffee'),
    name: 'Кофе в подарок',
    description: 'Любой напиток с кофейной стойки.',
    priceMinor: 12_000,
    pointsPrice: 12_000,
  },
  {
    id: demoUuid('catalog:dessert'),
    name: 'Десерт дня',
    description: 'То, что сегодня на витрине.',
    priceMinor: 18_000,
    pointsPrice: 18_000,
  },
  {
    id: demoUuid('catalog:set'),
    name: 'Сет на двоих',
    description: 'Два основных блюда и десерт.',
    priceMinor: 180_000,
    pointsPrice: 180_000,
  },
  {
    id: demoUuid('catalog:pasta'),
    name: 'Паста дня',
    description: 'Без цены в баллах: в карте гостя её нет.',
    priceMinor: 32_000,
    pointsPrice: null,
  },
]

const COFFEE = DEMO_CATALOG[0]
const DESSERT = DEMO_CATALOG[1]

export interface DemoChannel {
  readonly id: string
  readonly name: string
  readonly code: string
}

/**
 * Источники гостей. Код постоянный: ссылка «вступить в демо-кафе» стоит
 * на странице показа, и после повторного запуска она обязана работать.
 */
export const DEMO_CHANNELS: readonly [DemoChannel, DemoChannel] = [
  { id: demoUuid('channel:desk'), name: 'Табличка на стойке', code: HumanCode.parse('DEMQRDSK') },
  { id: demoUuid('channel:instagram'), name: 'Instagram', code: HumanCode.parse('DEMGRAM2') },
]

export interface DemoTag {
  readonly id: string
  readonly name: string
  readonly color: 'slate' | 'mint' | 'sky' | 'amber' | 'rose' | 'violet'
}

export const DEMO_TAGS: readonly DemoTag[] = [
  { id: demoUuid('tag:vip'), name: 'VIP', color: 'amber' },
  { id: demoUuid('tag:veggie'), name: 'Вегетарианец', color: 'mint' },
  { id: demoUuid('tag:nuts'), name: 'Аллергия на орехи', color: 'rose' },
  { id: demoUuid('tag:terrace'), name: 'Любит террасу', color: 'sky' },
]

export interface DemoAutomation {
  readonly kind: 'SLEEPING' | 'JOINED_NO_PURCHASE'
  readonly enabled: boolean
  readonly threshold: number
  readonly text: string
}

/** Один сценарий включён, второй выключен — оба состояния на виду. */
export const DEMO_AUTOMATIONS: readonly DemoAutomation[] = [
  {
    kind: 'SLEEPING',
    enabled: true,
    threshold: 30,
    text: 'Соскучились! Заходите — кофе за нами, если покажете это сообщение.',
  },
  {
    kind: 'JOINED_NO_PURCHASE',
    enabled: false,
    threshold: 7,
    text: 'Вы с нами, но ещё не заглядывали. Ждём вас на завтрак.',
  },
]

// ─── Акции ───────────────────────────────────────────────────────────────────

export interface DemoOffer {
  readonly id: string
  readonly type: CreateOfferInput['type']
  readonly status: 'LIVE' | 'DRAFT'
  readonly priority: number
  readonly stackable: boolean
  readonly audience: CreateOfferInput['audience']
  readonly schedule: CreateOfferInput['schedule']
  readonly limits: CreateOfferInput['limits']
  readonly reward: CreateOfferInput['reward']
  readonly i18n: OfferI18n
}

/**
 * Акция в том виде, в каком её записал бы конструктор бэк-офиса:
 * вход — через ту же схему `CreateOfferInput`, тексты «как воспользоваться» —
 * тем же `engineOfferTexts`, что у сервера.
 */
const offer = (key: string, raw: unknown): DemoOffer => {
  const input = CreateOfferInput.parse(raw)

  return {
    id: demoUuid(`offer:${key}`),
    type: input.type,
    status: input.launch === 'NOW' ? 'LIVE' : 'DRAFT',
    priority: input.priority,
    stackable: input.stackable,
    audience: input.audience,
    schedule: input.schedule,
    limits: input.limits,
    reward: input.reward,
    i18n: engineOfferTexts({ title: input.title, reward: input.reward, limits: input.limits }),
  }
}

/**
 * Акции демо-кафе. Даты прошедшей акции считаются от начала истории:
 * она закончилась сама, по расписанию, как заканчиваются настоящие.
 */
export const buildDemoOffers = (firstDay: number): readonly DemoOffer[] => [
  // Отвечает на провал 14–17 из профиля дня: совет дашборда и акция видны рядом.
  offer('quiet-hours', {
    type: 'CASHBACK',
    title: 'Тихие часы: +10 % баллами с 14 до 17',
    schedule: { weekdays: [1, 2, 3, 4, 5], timeWindow: { from: '14:00', to: '17:00' } },
    reward: { kind: 'EARN_PERCENT', percent: 10 },
  }),
  offer('dessert', {
    type: 'PROMO_ON_CHECK',
    title: 'Десерт в подарок к чеку от 800 ฿',
    limits: { minCheck: 80_000, perGuestQty: 1 },
    reward: {
      kind: 'GIFT_CODE',
      gift: { kind: 'FREE_ITEM', itemName: 'Десерт дня' },
      validityDays: 14,
    },
  }),
  offer('winback', {
    type: 'CASHBACK',
    title: 'Соскучились: +15 % тем, кто не был месяц',
    audience: { kind: 'SLEEPING', notVisitedDays: 30 },
    reward: { kind: 'EARN_PERCENT', percent: 15 },
  }),
  offer('terrace-week', {
    type: 'CASHBACK',
    title: 'Неделя открытия террасы: +20 %',
    schedule: {
      startsAt: venueMoment(firstDay + 20, 0, 0).toISOString(),
      endsAt: venueMoment(firstDay + 27, 0, 0).toISOString(),
    },
    reward: { kind: 'EARN_PERCENT', percent: 20 },
  }),
  offer('low-season', {
    type: 'CASHBACK',
    title: 'Двойные баллы туристам в низкий сезон',
    audience: { kind: 'TOURIST' },
    reward: { kind: 'EARN_PERCENT', percent: 10 },
    launch: 'DRAFT',
  }),
]

// ─── Новости ─────────────────────────────────────────────────────────────────

export interface DemoNews {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly publishedAt: Date
}

export const buildDemoNews = (firstDay: number): readonly DemoNews[] => [
  {
    id: demoUuid('news:summer-menu'),
    title: 'Летнее меню уже здесь',
    body: 'Манго-боул, холодный кокосовый кофе и салат с пеламидой. Попробуйте — за каждый заказ баллы как обычно.',
    publishedAt: venueMoment(firstDay + 30, 10, 0),
  },
  {
    id: demoUuid('news:early-coffee'),
    title: 'Кофе с собой — теперь с 7 утра',
    body: 'Открываем кофейную стойку на час раньше. Идёте на пляж — заберите капучино по дороге.',
    publishedAt: venueMoment(firstDay + 70, 9, 0),
  },
  {
    id: demoUuid('news:live-music'),
    title: 'Живая музыка по пятницам',
    body: 'С 19:00 играет акустический дуэт. Столики на террасе лучше бронировать заранее.',
    publishedAt: venueMoment(firstDay + 86, 12, 0),
  },
]

// ─── Гости ───────────────────────────────────────────────────────────────────

/** Имена придуманы; фамилия — инициалом, как гости и подписываются. */
const TOURIST_FIRST_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['Анна', 'ru'],
  ['Дмитрий', 'ru'],
  ['Emma', 'en'],
  ['Wei', 'zh'],
  ['Ольга', 'ru'],
  ['James', 'en'],
  ['Сергей', 'ru'],
  ['Sophie', 'en'],
  ['Fang', 'zh'],
  ['Мария', 'ru'],
  ['Liam', 'en'],
  ['Иван', 'ru'],
  ['Olivia', 'en'],
  ['Min', 'zh'],
  ['Екатерина', 'ru'],
  ['Noah', 'en'],
  ['Алексей', 'ru'],
  ['Charlotte', 'en'],
  ['Наталья', 'ru'],
  ['Lucas', 'en'],
  ['Михаил', 'ru'],
  ['Hana', 'en'],
  ['Юлия', 'ru'],
  ['Jun', 'zh'],
]

const RESIDENT_FIRST_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['Somchai', 'th'],
  ['Nong', 'th'],
  ['Павел', 'ru'],
  ['Kanya', 'th'],
  ['Anan', 'th'],
  ['Елена', 'ru'],
  ['Malee', 'th'],
  ['Mark', 'en'],
  ['Niran', 'th'],
  ['Артём', 'ru'],
  ['Sunee', 'th'],
  ['Ploy', 'th'],
  ['Виктория', 'ru'],
  ['Chai', 'th'],
  ['Julia', 'en'],
  ['Kittisak', 'th'],
]

const CYRILLIC_INITIALS = 'АБВГДЕЗИКЛМНОПРСТ'
const LATIN_INITIALS = 'ABCDKLMNPRSTW'

export interface DemoGuest {
  readonly index: number
  readonly guestId: string
  readonly membershipId: string
  readonly phoneE164: string
  readonly displayName: string
  readonly locale: string
  readonly mode: 'TOURIST' | 'RESIDENT'
  readonly birthday: Date | null
  readonly source: 'ORGANIC' | 'REFERRAL' | 'STAFF'
  readonly channelId: string | null
  /** Индекс пригласившего гостя; null — пришёл сам. */
  readonly referrerIndex: number | null
  readonly isControlGroup: boolean
  readonly tagIds: readonly string[]
}

/** +44 7700 900000–900999 — диапазон Ofcom для вымысла, абонентам не выдаётся. */
const phoneOf = (index: number): string => `+447700900${String(index).padStart(3, '0')}`

/** Семеро из десяти указали день рождения; шаг 37 дней разносит даты по году. */
const birthdayOf = (index: number): Date | null => {
  if (index % 10 >= 7) return null
  const dayOfYear = (index * 37 + 5) % 365
  const year = 1972 + ((index * 7) % 33)
  return new Date(Date.UTC(year, 0, 1) + dayOfYear * MS_PER_DAY)
}

const nameOf = (index: number): { displayName: string; locale: string } => {
  const isTourist = index < TOURIST_COUNT
  const local = isTourist ? index : index - TOURIST_COUNT
  const [first, locale] = pick(isTourist ? TOURIST_FIRST_NAMES : RESIDENT_FIRST_NAMES, local)
  const initials = locale === 'ru' ? CYRILLIC_INITIALS : LATIN_INITIALS
  const initial = pick([...initials], local * 7)
  return { displayName: `${first} ${initial}.`, locale }
}

/**
 * Пригласившие. Цепочка из четырёх резидентов даёт все три круга процента
 * с покупок; остальные приглашённые висят на тех, кто ходит чаще всех.
 */
const REFERRAL_CHAIN: readonly number[] = [96, 97, 98, 99]

const referrerOf = (index: number): number | null => {
  const inChain = REFERRAL_CHAIN.indexOf(index)
  if (inChain > 0) return REFERRAL_CHAIN[inChain - 1] ?? null
  if (inChain === 0) return null
  if (index % 6 === 2) return pick(REFERRAL_CHAIN, index)
  return null
}

const tagsOf = (index: number): string[] => {
  const tags: string[] = []
  const [vip, veggie, nuts, terrace] = DEMO_TAGS
  if (index >= TOURIST_COUNT && index % 10 === 1 && vip) tags.push(vip.id)
  if (index % 9 === 4 && veggie) tags.push(veggie.id)
  if (index % 23 === 5 && nuts) tags.push(nuts.id)
  if (index >= TOURIST_COUNT && index % 7 === 3 && terrace) tags.push(terrace.id)
  return tags
}

export const buildDemoGuests = (): readonly DemoGuest[] =>
  Array.from({ length: GUEST_COUNT }, (_, index) => {
    const { displayName, locale } = nameOf(index)
    const referrerIndex = referrerOf(index)
    const source = referrerIndex !== null ? 'REFERRAL' : index % 11 === 6 ? 'STAFF' : 'ORGANIC'
    const channelId =
      source !== 'ORGANIC'
        ? null
        : index % 3 === 0
          ? DEMO_CHANNELS[0].id
          : index % 7 === 1
            ? DEMO_CHANNELS[1].id
            : null

    return {
      index,
      guestId: demoUuid(`guest:${index}`),
      membershipId: demoUuid(`membership:${index}`),
      phoneE164: phoneOf(index),
      displayName,
      locale,
      mode: index < TOURIST_COUNT ? 'TOURIST' : 'RESIDENT',
      birthday: birthdayOf(index),
      source,
      channelId,
      referrerIndex,
      isControlGroup: index % CONTROL_GROUP_EVERY === CONTROL_GROUP_OFFSET,
      tagIds: tagsOf(index),
    }
  })

// ─── Визиты ──────────────────────────────────────────────────────────────────

export interface DemoReview {
  readonly id: string
  readonly rating: number
  readonly tags: readonly ReviewTag[]
  readonly comment: string | null
  /** Автоответ из настроек — у оценок 1, 2 и 5. Тройки ждут ответа владельца. */
  readonly reply: string | null
  readonly createdAt: Date
}

/**
 * Откуда пришла операция. Демо-кафе работает на кассе POSitive POS: чек
 * приезжает вебхуком сам, а кассир в приложении пробивает руками только
 * то, что касса не умеет, — оплату баллами, награду, редкий чек мимо кассы.
 * Будь всё ручным, дашборд справедливо советовал бы «много ручного ввода».
 */
export type DemoChannelOfOrigin = 'POS' | 'CASHIER'

interface EventBase {
  readonly key: string
  readonly membershipId: string
  readonly occurredAt: Date
  /** Кассир смены: подписывает ручные операции и получает оценку визита. */
  readonly cashierId: string
  readonly via: DemoChannelOfOrigin
}

export interface DemoEarn extends EventBase {
  readonly kind: 'EARN'
  readonly amount: number
  readonly basisAmount: number
  readonly receiptId: string
  readonly saleKindId: string
  readonly review: DemoReview | null
}

export interface DemoRedeem extends EventBase {
  readonly kind: 'REDEEM'
  readonly amount: number
  readonly refType: 'receipt' | 'catalog_item'
  readonly refId: string
}

export type DemoEvent = DemoEarn | DemoRedeem

/** Кто ходит как: турист — короткими наездами, резидент — круглый год. */
const visitChance = (guest: DemoGuest, day: number, firstDay: number): number => {
  if (guest.mode === 'TOURIST') {
    // Поездки повторяются раз в 140 дней: в любом окне истории кто-то из
    // туристов на острове, а кто-то только приехал.
    const period = 140
    const offset = (guest.index * 53) % period
    const stay = 4 + (guest.index % 9)
    return (((day - offset) % period) + period) % period < stay ? 0.4 : 0
  }

  // Каждый восьмой резидент перестал ходить: на нём видны «спящие»
  // и акция «Соскучились».
  if (guest.index % 8 === 0 && day > firstDay + 45) {
    return 0
  }

  return 0.08 + (guest.index % 7) * 0.03
}

const RATING_WEIGHTS = [4, 6, 10, 20, 60] as const

const COMMENTS: Readonly<Record<number, readonly (string | null)[]>> = {
  1: ['Ждали заказ сорок минут и ушли.'],
  2: ['Принесли остывшую пасту.', 'Официант забыл про наш заказ.'],
  3: ['Нормально, ничего особенного.', 'Вкусно, но долго несли.'],
  4: ['Всё хорошо, только шумно вечером.', 'Вкусно, чуть дороговато.', null],
  5: ['Лучший кофе на Кате!', 'Очень вкусно, вернёмся.', 'Быстро и приветливо.', null, null],
}

const REVIEW_TAGS_BY_RATING: Readonly<Record<number, readonly ReviewTag[][]>> = {
  1: [['SERVICE'], ['SERVICE', 'STAFF']],
  2: [['QUALITY'], ['SERVICE']],
  3: [['SERVICE'], ['PRICE'], []],
  4: [['QUALITY'], ['PRICE'], []],
  5: [['QUALITY', 'STAFF'], ['QUALITY'], ['STAFF'], []],
}

const reviewFor = (key: string, occurredAt: Date, now: Date): DemoReview => {
  const random = randomFor(`review:${key}`)
  const rating = weightedIndex(random, RATING_WEIGHTS) + 1
  const autoReply = DEMO_SETTINGS.reviews.autoReplies[rating - 1] ?? null
  const createdAt = new Date(Math.min(occurredAt.getTime() + 90 * 60 * 1000, now.getTime()))

  return {
    id: demoUuid(`review:${key}`),
    rating,
    tags: pick(REVIEW_TAGS_BY_RATING[rating] ?? [[]], intBetween(random, 0, 9)),
    comment: pick(COMMENTS[rating] ?? [null], intBetween(random, 0, 9)),
    reply: autoReply,
    createdAt,
  }
}

/** Доля чеков, пробитых кассиром руками, — ниже порога совета дашборда (40 %). */
const MANUAL_SHARE = 0.2

/**
 * Один гость, накручивающий чеки у одного кассира: семь покупок за утро,
 * все руками. На нём «Безопасность» показывает, как выглядит подозрительное.
 */
const SUSPICIOUS_GUEST = 101

const burstEvents = (guest: DemoGuest, today: number, now: Date): DemoEvent[] => {
  const day = today - 3
  const [, may] = DEMO_CASHIERS

  return Array.from({ length: 7 }, (_, n) => {
    const basisAmount = (30 + n * 4) * RECEIPT_STEP_MINOR
    const key = `demo:${VERSION}:burst:${guest.membershipId}:${dayKey(day)}:${String(n)}`

    return {
      kind: 'EARN' as const,
      key,
      membershipId: guest.membershipId,
      occurredAt: venueMoment(day, 10, 5 + n * 12),
      cashierId: may.id,
      via: 'CASHIER' as const,
      amount: Math.floor((basisAmount * DEMO_SETTINGS.baseEarnRate) / 100),
      basisAmount,
      receiptId: `DM-${dayKey(day)}-B${String(n)}`,
      saleKindId: pick(DEMO_SALE_KINDS, 2).id,
      review: null,
    }
  }).filter((event) => event.occurredAt.getTime() <= now.getTime())
}

/**
 * Все операции демо-гостя от первого дня истории до текущей минуты,
 * по порядку времени.
 *
 * Баллы — по базовой ставке, как у полигона: статус гостя проставит после
 * истории тот же код, что после настоящего чека, а своей формулы «кто VIP»
 * у скрипта нет.
 */
export const buildGuestEvents = (
  guest: DemoGuest,
  firstDay: number,
  now: Date,
): readonly DemoEvent[] => {
  const today = venueDay(now)
  const events: DemoEvent[] = []
  let balance = 0

  for (let day = firstDay; day <= today; day += 1) {
    const random = randomFor(`visit:${String(guest.index)}:${dayKey(day)}`)
    const chance = visitChance(guest, day, firstDay) * (WEEKDAY_WEIGHTS[weekdayOf(day)] ?? 1)

    if (random() >= chance) continue

    const hour = weightedIndex(random, HOUR_WEIGHTS)
    const minute = intBetween(random, 0, 59)
    const occurredAt = venueMoment(day, hour, minute)

    // Сегодняшний ужин, который ещё не наступил, появится при следующем запуске.
    if (occurredAt.getTime() > now.getTime()) continue

    const [noi, may] = DEMO_CASHIERS
    const cashierId = hour < 15 ? noi.id : may.id
    const steps =
      guest.mode === 'TOURIST' ? intBetween(random, 60, 360) : intBetween(random, 30, 220)
    const check = steps * RECEIPT_STEP_MINOR
    const receiptId = `DM-${dayKey(day)}-${String(guest.index)}`
    const visitKey = `demo:${VERSION}:${guest.membershipId}:${dayKey(day)}`
    const saleKindId = pick(DEMO_SALE_KINDS, weightedIndex(random, [7, 2, 1])).id

    // Часть чека баллами — как «Оплата баллами» на кассе: не больше 30 %.
    // Редко и только с запасом: у гостя для показа на кассе баллы должны быть.
    let paidWithPoints = 0
    if (!guest.isControlGroup && balance >= 50_000 && random() < 0.05) {
      paidWithPoints = Math.min(balance, Math.floor((check * DEMO_SETTINGS.baseRedeemRate) / 100))
      events.push({
        kind: 'REDEEM',
        key: `${visitKey}:pay`,
        membershipId: guest.membershipId,
        occurredAt,
        cashierId,
        via: 'CASHIER',
        amount: paidWithPoints,
        refType: 'receipt',
        refId: receiptId,
      })
      balance -= paidWithPoints
    }

    const basisAmount = check - paidWithPoints
    // Чек с оплатой баллами пробит в приложении кассира — целиком там же.
    const via: DemoChannelOfOrigin =
      paidWithPoints > 0 || random() < MANUAL_SHARE ? 'CASHIER' : 'POS'
    const amount = guest.isControlGroup
      ? 0
      : Math.floor((basisAmount * DEMO_SETTINGS.baseEarnRate) / 100)
    const reviewed = !guest.isControlGroup && today - day < 75 && random() < 0.2

    events.push({
      kind: 'EARN',
      key: `${visitKey}:earn`,
      membershipId: guest.membershipId,
      occurredAt,
      cashierId,
      via,
      amount,
      basisAmount,
      receiptId,
      saleKindId,
      review: reviewed ? reviewFor(visitKey, occurredAt, now) : null,
    })
    balance += amount

    // Награда за баллы — кофе почаще, десерт пореже.
    const reward =
      COFFEE !== undefined && balance >= COFFEE.priceMinor && random() < 0.08
        ? COFFEE
        : DESSERT !== undefined && balance >= DESSERT.priceMinor && random() < 0.04
          ? DESSERT
          : null

    if (reward !== null && !guest.isControlGroup) {
      const rewardAt = new Date(occurredAt.getTime() + 2 * 60 * 1000)

      if (rewardAt.getTime() <= now.getTime()) {
        events.push({
          kind: 'REDEEM',
          key: `${visitKey}:reward`,
          membershipId: guest.membershipId,
          occurredAt: rewardAt,
          cashierId,
          via: 'CASHIER',
          amount: reward.priceMinor,
          refType: 'catalog_item',
          refId: reward.id,
        })
        balance -= reward.priceMinor
      }
    }
  }

  if (guest.index === SUSPICIOUS_GUEST && today - 3 >= firstDay) {
    events.push(...burstEvents(guest, today, now))
  }

  return events.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
}

/**
 * Когда гость появился: перед первой покупкой, а у тех, кто ещё не покупал, —
 * где-то внутри истории. Резиденты — постоянные — с нами давно.
 */
export const guestJoinedAt = (
  guest: DemoGuest,
  events: readonly DemoEvent[],
  firstDay: number,
  now: Date,
): Date => {
  if (guest.mode === 'RESIDENT') {
    return venueMoment(firstDay - 30 - ((guest.index * 11) % 300), 12, 0)
  }

  const first = events[0]
  if (first !== undefined) {
    return new Date(first.occurredAt.getTime() - 10 * 60 * 1000)
  }

  const joined = venueMoment(firstDay + ((guest.index * 13) % HISTORY_DAYS), 11, 0)
  return joined.getTime() > now.getTime() ? now : joined
}

/**
 * Гости, чьи телефоны удобно вбить на кассе при показе: резиденты, которые
 * ходят чаще всех, не из контрольной группы. Nong — второй круг цепочки
 * приглашений, на нём видны и проценты с покупок друзей.
 */
export const SHOWCASE_GUEST_INDEXES: readonly number[] = [97, 108, 118]
