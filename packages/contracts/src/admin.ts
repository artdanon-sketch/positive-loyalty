import { z } from 'zod'

import { LedgerSource, LedgerType } from './ledger.js'

/**
 * Контракты бэк-офиса заведения.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ tenantId НИ В ОДНОМ ВХОДЕ. Он берётся только из токена
 * (CLAUDE.md, железное правило 2). Поле во входной схеме означало бы, что
 * заведение может назвать чужой идентификатор и получить чужие данные —
 * ровно та дыра, ради закрытия которой существует изоляция тенантов.
 */

/** Одна операция в журнале — то, что видно в списке операций. */
export const AdminLedgerEntry = z
  .object({
    id: z.uuid(),
    type: LedgerType,
    source: LedgerSource,
    /** Знаковое: плюс начисление, минус списание. Целое, в баллах. */
    amount: z.number().int(),
    balanceAfter: z.number().int(),
    /** Сумма чека в минорных единицах. Может отсутствовать: не всякая операция от чека. */
    basisAmount: z.number().int().nonnegative().nullable(),
    membershipId: z.uuid(),
    guestId: z.uuid(),
    /** Номер чека или иной внешний идентификатор источника. */
    refId: z.string().nullable(),
    /** Заполнено у компенсаций: какую операцию отменяет. */
    reversalOfId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type AdminLedgerEntry = z.infer<typeof AdminLedgerEntry>

export const AdminLedgerList = z
  .object({
    items: z.array(AdminLedgerEntry),
    /** Сколько всего операций у заведения. Нужно для постраничной навигации. */
    total: z.number().int().nonnegative(),
  })
  .strict()

export type AdminLedgerList = z.infer<typeof AdminLedgerList>

/** Участие гостя в программе заведения. */
export const AdminMembership = z
  .object({
    id: z.uuid(),
    guestId: z.uuid(),
    /**
     * Кэш баланса. Источник истины — журнал; расхождение ловит ежесуточная сверка.
     */
    pointsBalance: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    spentTotal: z.number().int().nonnegative(),
    /** Гость в контрольной группе: баллы ему не начисляются, и он об этом знает. */
    isControlGroup: z.boolean(),
    lastVisitAt: z.iso.datetime().nullable(),
  })
  .strict()

export type AdminMembership = z.infer<typeof AdminMembership>

/** Постраничный запрос списка. Верхняя граница жёсткая: без неё это выгрузка базы. */
export const AdminListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export type AdminListQuery = z.infer<typeof AdminListQuery>

/** Откуда гость пришёл в программу. */
export const GuestSource = z.enum(['ORGANIC', 'CATALOG', 'REFERRAL', 'STAFF', 'IMPORT'])
export type GuestSource = z.infer<typeof GuestSource>

/** Гость в списке бэк-офиса — участие плюс витринные поля гостя. */
export const AdminGuestRow = z
  .object({
    /** Идентификатор участия: все действия на экране адресуются к нему. */
    membershipId: z.uuid(),
    guestId: z.uuid(),
    displayName: z.string().nullable(),
    /**
     * Телефон. Менеджеру приходит маскированным («+66 •• •• 4821»), владельцу —
     * целиком: матрица прав docs/05, раздел 3 разрешает полный номер только ему.
     * Решение о маскировании принимает сервер по роли из токена — клиент
     * ничего не «домаскирует», у него просто нет полного значения.
     */
    /** null — гость вошёл через аккаунт и номер не оставлял. */
    phone: z.string().min(1).nullable(),
    mode: z.enum(['TOURIST', 'RESIDENT']),
    pointsBalance: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    /** Сумма покупок в минорных единицах. */
    spentTotal: z.number().int().nonnegative(),
    lastVisitAt: z.iso.datetime().nullable(),
    isControlGroup: z.boolean(),
    source: GuestSource,
    /** С какого визита гость в программе. null — визитов ещё не было. */
    firstVisitAt: z.iso.datetime().nullable(),
    /**
     * Статус из настроек программы. Лестница пересчитывается сразу после правки
     * настроек, поэтому здесь тот же статус, что в карточке. null — статуса нет.
     */
    tier: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  })
  .strict()

export type AdminGuestRow = z.infer<typeof AdminGuestRow>

export const AdminGuestsList = z
  .object({
    items: z.array(AdminGuestRow),
    total: z.number().int().nonnegative(),
  })
  .strict()

export type AdminGuestsList = z.infer<typeof AdminGuestsList>

/**
 * Список гостей с поиском. docs/10, раздел 5.2 — «поиск-везде».
 *
 * ОДНА СТРОКА, ЧЕТЫРЕ СМЫСЛА: последние цифры телефона, имя, промокод, номер
 * чека. Человек у стойки не выбирает, по какому полю искать, — он повторяет то,
 * что сказал гость: «…4821», «Анна», «у меня код», «вот чек».
 *
 * Пустая строка — не ошибка, а «без поиска»: поле очистили.
 */
export const AdminGuestsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    q: z.string().trim().max(64).optional(),
    /** Турист или резидент. */
    mode: z.enum(['TOURIST', 'RESIDENT']).optional(),
    /** id статуса из настроек программы. */
    tier: z.string().min(1).max(40).optional(),
    source: GuestSource.optional(),
    /** Были, но не заходили дольше, дней. От недели: реже — это не сон, а график. */
    sleeping: z.coerce.number().int().min(7).max(365).optional(),
    /** `none` — ни разу не покупали. */
    buyers: z.enum(['none']).optional(),
  })
  .strict()

export type AdminGuestsQuery = z.infer<typeof AdminGuestsQuery>

/**
 * Фильтры списка гостей — те же в списке и в выгрузке. docs/02, раздел 5.2 · docs/11, У4.
 *
 * Складываются через «и»: «спящие резиденты со статусом Золото» — три фильтра сразу.
 */
export type AdminGuestFilters = Omit<AdminGuestsQuery, 'limit' | 'offset'>

/**
 * Выгрузка гостей. Только владелец, причина обязательна и уходит в аудит:
 * «ваша база принадлежит вам» — часть продажи, но каждая выгрузка на виду.
 */
export const GuestExportInput = z
  .object({
    reason: z.string().trim().min(8).max(300),
    filters: AdminGuestsQuery.omit({ limit: true, offset: true }).default({}),
    /** Язык заголовков и подписей в файле. */
    locale: z.enum(['ru', 'en']).default('ru'),
  })
  .strict()

export type GuestExportInput = z.infer<typeof GuestExportInput>

/** Язык названий подарков в карточке — язык интерфейса того, кто смотрит. */
export const AdminGuestCardQuery = z
  .object({
    locale: z.enum(['ru', 'en', 'th', 'zh']).default('ru'),
  })
  .strict()

export type AdminGuestCardQuery = z.infer<typeof AdminGuestCardQuery>

/**
 * Судьба подарка.
 *
 * EXPIRED вычисляет сервер по сроку, а не только читает из базы: подарок, срок
 * которого прошёл вчера, в базе может ещё числиться выданным — фоновая задача
 * не обязана успеть. Владельцу нужна правда о сегодняшнем дне.
 */
export const AdminGiftState = z.enum(['ISSUED', 'REDEEMED', 'EXPIRED', 'VOID'])
export type AdminGiftState = z.infer<typeof AdminGiftState>

/** Операция в истории гостя. */
export const AdminTimelineOperation = z
  .object({
    kind: z.literal('OPERATION'),
    id: z.uuid(),
    /** Когда операция ПРОИЗОШЛА: чек, досланный кассой вечером, стоит на своём часе. */
    at: z.iso.datetime(),
    type: LedgerType,
    source: LedgerSource,
    /** Знаковое, в баллах. */
    amount: z.number().int(),
    /** Сумма чека в сатангах. */
    basisAmount: z.number().int().nonnegative().nullable(),
    receiptId: z.string().nullable(),
    /** Что продали — если заведение ведёт виды продаж. */
    saleKind: z.string().nullable(),
    /** Кто провёл. null — касса по вебхуку или система. */
    staffName: z.string().nullable(),
    /** Операцию отменили — рядом в истории стоит её компенсация. */
    reversed: z.boolean(),
  })
  .strict()

export type AdminTimelineOperation = z.infer<typeof AdminTimelineOperation>

/**
 * Подарок в истории гостя — одной строкой со всем путём:
 * «выдан 3 сентября → погашен 5 сентября, чек 1042».
 *
 * КОДА ЦЕЛИКОМ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Код — это сам подарок: кто его знает,
 * тот его и погасит. Сотруднику в бэк-офисе полный код не нужен ни для чего,
 * кроме как погасить подарок самому себе. Последних четырёх знаков достаточно,
 * чтобы сверить с экраном гостя. Граница стоит в схеме: строка длиннее четырёх
 * знаков не пройдёт разбор, даже если сервер однажды ошибётся.
 */
export const AdminTimelineGift = z
  .object({
    kind: z.literal('GIFT'),
    grantId: z.uuid(),
    /** Когда выдан. */
    at: z.iso.datetime(),
    title: z.string().nullable(),
    codeTail: z.string().min(1).max(4),
    state: AdminGiftState,
    expiresAt: z.iso.datetime(),
    redeemedAt: z.iso.datetime().nullable(),
    redeemedReceiptId: z.string().nullable(),
  })
  .strict()

export type AdminTimelineGift = z.infer<typeof AdminTimelineGift>

export const AdminTimelineItem = z.discriminatedUnion('kind', [
  AdminTimelineOperation,
  AdminTimelineGift,
])

export type AdminTimelineItem = z.infer<typeof AdminTimelineItem>

/**
 * Карточка гостя: кто он для заведения и что с ним происходило.
 *
 * ИСТОРИЯ — ОДНОЙ ЛЕНТОЙ, А НЕ ВКЛАДКАМИ. Спор у стойки звучит как «мне не
 * начислили за вчерашний ужин, а подарок не дали». Ответ на него — чек, баллы
 * и подарок рядом на одной оси времени, а не на трёх вкладках.
 */
export const AdminGuestCard = z
  .object({
    guestId: z.uuid(),
    membershipId: z.uuid(),
    displayName: z.string().nullable(),
    /** Маска для менеджера, целиком для владельца — как в списке. */
    phone: z.string().min(1).nullable(),
    mode: z.enum(['TOURIST', 'RESIDENT']),
    source: GuestSource,
    isControlGroup: z.boolean(),
    /**
     * Статус гостя — тем же расчётом, что у кассы. `manual` — назначен владельцем
     * и после чека не пересчитывается. null — лестницы в заведении нет.
     */
    tier: z.object({ id: z.string(), name: z.string(), manual: z.boolean() }).strict().nullable(),
    firstVisitAt: z.iso.datetime().nullable(),
    lastVisitAt: z.iso.datetime().nullable(),
    pointsBalance: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    spentTotal: z.number().int().nonnegative(),
    /** Сатанги. null — визитов не было, делить не на что. */
    averageCheck: z.number().int().nonnegative().nullable(),
    /** Новые сверху. */
    timeline: z.array(AdminTimelineItem),
    /** Сколько последних операций и подарков показывается. */
    timelineLimit: z.number().int().positive(),
    /** Показано не всё: старое — в «Операциях». */
    timelineTruncated: z.boolean(),
  })
  .strict()

export type AdminGuestCard = z.infer<typeof AdminGuestCard>

// ─── Дашборд ─────────────────────────────────────────────────────────────────

/**
 * Период дашборда. docs/02, раздел 5.1.
 *
 * Дельта всегда считается к ПРЕДЫДУЩЕМУ отрезку той же длины: «за 7 дней»
 * сравнивается с семью днями до них, а не с прошлой неделей календаря.
 * Так владелец видит движение, а не эффект от того, в какой день он зашёл.
 */
export const DashboardPeriod = z.enum(['7d', '30d', '90d'])
export type DashboardPeriod = z.infer<typeof DashboardPeriod>

export const DashboardQuery = z
  .object({
    period: DashboardPeriod.default('7d'),
  })
  .strict()

export type DashboardQuery = z.infer<typeof DashboardQuery>

/** Плитка «Пришло по программе». */
export const DashboardGuests = z
  .object({
    value: z.number().int().nonnegative(),
    prev: z.number().int().nonnegative(),
    /**
     * Изменение в процентах. `null`, когда сравнивать не с чем: в прошлом
     * периоде нуль, и любая цифра роста была бы делением на ноль,
     * приукрашенным до «+100%».
     */
    changePct: z.number().nullable(),
    /** Из них пришли впервые. */
    newGuests: z.number().int().nonnegative(),
  })
  .strict()

export type DashboardGuests = z.infer<typeof DashboardGuests>

/**
 * Плитка «Я должен баллами» — обязательство перед гостями в минорных единицах.
 *
 * Формулировка в интерфейсе задана ТЗ дословно (docs/03, раздел 2):
 * «обязательство перед гостями, не расход».
 */
export const DashboardLiability = z
  .object({
    value: z.number().int(),
    /** Сколько было на начало периода. */
    prev: z.number().int(),
  })
  .strict()

export type DashboardLiability = z.infer<typeof DashboardLiability>

/** Столбец графика «Гости по дням»: дата в местном времени заведения. */
export const DashboardDay = z
  .object({
    /** `YYYY-MM-DD` в часовом поясе заведения, а не в UTC. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Пришли в это заведение впервые. */
    new: z.number().int().nonnegative(),
    returning: z.number().int().nonnegative(),
  })
  .strict()

export type DashboardDay = z.infer<typeof DashboardDay>

/** Точка графика «Загрузка по часам»: средний будний день. */
export const DashboardHour = z
  .object({
    hour: z.number().int().min(0).max(23),
    /** Среднее число гостей в этот час за будние дни периода. */
    guests: z.number().nonnegative(),
  })
  .strict()

export type DashboardHour = z.infer<typeof DashboardHour>

/**
 * Инкрементальность по контрольной группе. docs/02, раздел 5.1.
 *
 * Поле НЕОБЯЗАТЕЛЬНОЕ и осознанно отсутствует, когда контрольная группа меньше
 * тридцати человек: «статистики нет, и врать нельзя». Это не заглушка на потом,
 * а поведение по ТЗ — показать uplift по трём гостям значит продать заведению
 * шум под видом эффекта.
 */
export const DashboardIncremental = z
  .object({
    /** Средний чек участника программы, минорные единицы. */
    programAvgCheck: z.number().int().nonnegative(),
    /** Средний чек гостя из контрольной группы. */
    controlAvgCheck: z.number().int().nonnegative(),
    upliftPct: z.number(),
    controlSize: z.number().int().nonnegative(),
  })
  .strict()

export type DashboardIncremental = z.infer<typeof DashboardIncremental>

/**
 * Совет из блока «Что стоит сделать сегодня». docs/03, раздел 2.
 *
 * СЕРВЕР ОТДАЁТ ПОВОД И ЧИСЛА, А НЕ ГОТОВЫЙ ТЕКСТ. Продукт четырёхъязычный
 * (docs/04, раздел «Локализация»), строки живут в JSON фронта, и русская
 * фраза, собранная на сервере, приехала бы тайскому владельцу как есть.
 * Здесь же остаётся правило: пороги — бизнес-логика, ей не место в компоненте.
 *
 * Два повода из таблицы ТЗ пока не выдаются: «точка без напечатанного QR»
 * требует сущности Location, «акция кончается» — сущности Offer. Ни той,
 * ни другой ещё нет; выдумывать для них данные хуже, чем не выдавать совет.
 */
export const DashboardAdvice = z.discriminatedUnion('kind', [
  /**
   * Партнёры ждут нашего ответа: входящие приглашения и предложенные условия.
   * Единственное в партнёрствах, что требует действия прямо сейчас.
   */
  z
    .object({
      kind: z.literal('PARTNERS_WAITING'),
      invites: z.number().int().nonnegative(),
      terms: z.number().int().nonnegative(),
    })
    .strict(),
  /**
   * Партнёр прислал гостей, а ответного условия от него нет (docs/10, раздел 5.1):
   * разные гости партнёра за месяц погасили у нас не меньше десяти подарков.
   */
  z
    .object({
      kind: z.literal('PARTNER_RECIPROCATE'),
      partnershipId: z.uuid(),
      partnerName: z.string().min(1),
      guests: z.number().int().positive(),
    })
    .strict(),
  /**
   * Чеки не дошли с планшетов: застряли или опаздывают больше часа.
   * Гости по ним уже сейчас без баллов — это не прогноз, а долг, поэтому первым.
   */
  z.object({ kind: z.literal('STUCK_RECEIPTS'), receipts: z.number().int().positive() }).strict(),
  /**
   * Выданные подарки сгорят в ближайшие дни, если гости не придут.
   * docs/10, раздел 6.12: «сгорит через неделю» полезнее «сгорело» —
   * пока срок не вышел, гостя ещё можно позвать.
   */
  z
    .object({
      kind: z.literal('EXPIRING_GIFTS'),
      gifts: z.number().int().positive(),
      withinDays: z.number().int().positive(),
    })
    .strict(),
  /** Спящих гостей — не заходили больше месяца — набралось двадцать и больше. */
  z.object({ kind: z.literal('SLEEPING_GUESTS'), guests: z.number().int().nonnegative() }).strict(),
  /** Провал загрузки: три часа подряд и дольше заметно ниже среднего. */
  z
    .object({
      kind: z.literal('QUIET_HOURS'),
      fromHour: z.number().int().min(0).max(23),
      /** Включительно: 14–16 значит, что пустуют часы 14, 15 и 16. */
      toHour: z.number().int().min(0).max(23),
    })
    .strict(),
  /** Доля начислений, введённых кассиром руками, выше 40%. */
  z.object({ kind: z.literal('MANUAL_ENTRY'), sharePct: z.number() }).strict(),
])

export type DashboardAdvice = z.infer<typeof DashboardAdvice>

/**
 * Ответ дашборда. docs/02, раздел 5.1.
 *
 * `topOffer` из ТЗ здесь пока нет: акций в схеме ещё не существует, а плитка
 * с придуманной акцией — худшее, что можно показать владельцу на главной.
 * Появится вместе с движком акций.
 */
export const AdminDashboard = z
  .object({
    period: DashboardPeriod,
    guestsViaProgram: DashboardGuests,
    pointsLiability: DashboardLiability,
    series: z.array(DashboardDay),
    hourly: z.array(DashboardHour),
    incremental: DashboardIncremental.optional(),
    advice: z.array(DashboardAdvice),
    /**
     * Данных меньше, чем длина периода: заведение работает первую неделю.
     * Экран показывает график с пометкой «данных пока мало» и прячет дельты
     * (docs/03, раздел 2, состояния).
     */
    isPartialPeriod: z.boolean(),
    /** Ни одного оформленного гостя: вместо плиток — онбординг-чеклист. */
    isEmpty: z.boolean(),
  })
  .strict()

export type AdminDashboard = z.infer<typeof AdminDashboard>

// ─── Живая лента ─────────────────────────────────────────────────────────────

/**
 * Событие живой ленты. `GET /v1/admin/stream` (docs/03, раздел 2).
 *
 * ИМЯ ПРИХОДИТ ТОЛЬКО МАСКИРОВАННЫМ, и это отступление от примера в ТЗ.
 * Пример показывает рядом два поля — `guestName` и `masked`, — но лента висит
 * на экране в зале, и её видят посторонние. Полное имя, отправленное клиенту,
 * оказывается в разметке страницы и в инструментах разработчика независимо
 * от того, что мы рисуем. Маскировать нужно на сервере, до отправки, иначе
 * маскирование — украшение, а не защита (CLAUDE.md, железное правило 5).
 */
export const LiveFeedEvent = z
  .object({
    /** Идентификатор записи журнала: по нему лента не двоит при переподключении. */
    id: z.uuid(),
    /** Пока единственный вид события. Отдельным полем — чтобы добавить второй. */
    kind: z.literal('ledger.earned'),
    /** Имя до первой буквы: «А***». Пусто, если гость не назвался. */
    masked: z.string(),
    /** Начислено баллов, целое. */
    amount: z.number().int(),
    /** Сумма чека в минорных единицах. null, если операция не от чека. */
    basis: z.number().int().nullable(),
    at: z.iso.datetime(),
  })
  .strict()

export type LiveFeedEvent = z.infer<typeof LiveFeedEvent>
