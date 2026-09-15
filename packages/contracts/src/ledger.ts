import { z } from 'zod'

/**
 * Схемы входов и результата LedgerService.
 *
 * Источник правды по полям — docs/01_Архитектура_и_данные.md, раздел 4.4 «Ledger —
 * сердце системы». Здесь описан только контракт: сама транзакция, ретрай на 40001 и
 * запись в БД живут в apps/api/src/core/ledger.service.ts.
 *
 * Три правила из CLAUDE.md, которые видны прямо в схемах:
 *
 * 1. tenantId во входах НЕТ. Он берётся из токена через TenantContext. Поле во входной
 *    схеме означало бы, что его можно передать снаружи, — это mass assignment поверх
 *    границы тенанта.
 * 2. Все суммы — целые в минорных единицах (690 ฿ = 69000). Ни одного z.number()
 *    без .int().
 * 3. Идемпотентность обязательна: ключ есть в каждом входе и он непустой.
 *
 * .strict() на каждом объекте — без него лишние поля молча проходят валидацию.
 */

/**
 * Prisma-тип Int — это PostgreSQL integer, то есть int4. Значение вне диапазона не
 * «округлится», а упадёт на вставке уже после того, как транзакция начала работу.
 * Дешевле отсечь на границе, чем ловить 22003 из драйвера внутри Serializable.
 */
const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648

/** Разумный потолок длины ключа: это уникальный индекс, а не место для мусора. */
const IDEMPOTENCY_KEY_MAX = 128

/** Комментарий к отмене читает менеджер в AuditLog, а не парсер. */
const COMMENT_MAX = 500

/** Тип записи журнала. Соответствует LedgerEntry.type из раздела 4.4 ТЗ. */
export const LedgerType = z.enum(['EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL', 'GRANT'])

export type LedgerType = z.infer<typeof LedgerType>

/** Откуда пришла операция. Отвечает на вопрос «кто это начислил и можно ли ему верить». */
export const LedgerSource = z.enum([
  'POS_WEBHOOK',
  'POS_SYNC',
  'SIGNED_QR',
  'STAFF_MANUAL',
  'PAYMENT',
  'SYSTEM',
])

export type LedgerSource = z.infer<typeof LedgerSource>

/** Кто инициатор. Разделение STAFF и OWNER нужно антифроду: у них разные пороги. */
export const ActorType = z.enum(['SYSTEM', 'STAFF', 'OWNER', 'GUEST'])

export type ActorType = z.infer<typeof ActorType>

/**
 * На что ссылается запись. В prisma-схеме поле объявлено как String?, но открытая
 * строка означает refType 'reciept' в одном модуле и 'receipt' в другом — и сверка по
 * ссылкам перестаёт сходиться молча. Значения взяты из комментария к полю в ТЗ.
 */
export const LedgerRefType = z.enum(['receipt', 'offer_grant', 'referral', 'promo'])

export type LedgerRefType = z.infer<typeof LedgerRefType>

/** Почему отменяем. Причина уезжает в AuditLog и в отчёт по кассиру. */
export const ReversalReason = z.enum([
  'RECEIPT_VOIDED',
  'WRONG_AMOUNT',
  'REFUND',
  'DUPLICATE',
  'FRAUD_SUSPECTED',
  'STAFF_ERROR',
  'OTHER',
])

export type ReversalReason = z.infer<typeof ReversalReason>

/**
 * Ключ идемпотентности. Для вебхука POS это pos_receipt_id, для подписанного QR —
 * nonce, для ручного ввода — UUID, сгенерированный кассой ДО отправки. Формат не
 * фиксируем, но пустой ключ и ключ из одних пробелов — это отсутствие ключа.
 */
export const IdempotencyKey = z.string().trim().min(1).max(IDEMPOTENCY_KEY_MAX)

/** Неотрицательная целая сумма в минорных единицах, влезающая в int4. */
const MinorUnits = z.number().int().nonnegative().max(INT32_MAX)

/** ISO-4217, три заглавные буквы. Расчётов не касается, только подпись к сумме. */
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217: три заглавные буквы')

/**
 * Поля происхождения, общие для всех входов: кто, откуда, с какого устройства.
 * Вынесены отдельно, чтобы у earn, redeem и reverse не разъехались имена.
 *
 * ip — персональные данные (docs/05, раздел 8). В журнал пишется, в логи не попадает:
 * маскирование живёт в транспорте логгера, а не в вызывающем коде.
 */
/**
 * Когда операция произошла НА САМОМ ДЕЛЕ, если это не совпадает с моментом записи.
 *
 * Зачем поле нужно. Чек приходит от кассы вебхуком, и вебхук опаздывает: связь
 * на острове рвётся, касса работает офлайн и досылает смену целиком вечером.
 * Без этого поля вечерняя выгрузка легла бы одним столбцом в отчёте, а «загрузка
 * по часам» показала бы девять вечера вместо обеда. Это не косметика: по этим
 * графикам владелец решает, когда ставить акцию.
 *
 * Время записи при этом никуда не девается — `createdAt` остаётся неизменяемым
 * и продолжает отвечать на вопрос «когда мы об этом узнали». Разъезд между
 * ними — обычное дело в интеграциях, и путать их нельзя.
 *
 * НАСКОЛЬКО ДАЛЕКО НАЗАД РАЗРЕШЕНО ДАТИРОВАТЬ — вопрос границы, а не журнала.
 * Сервис запрещает только заведомо невозможное: будущее. Окно опоздания
 * («вебхук не старше стольких часов») проверяет контракт того эндпоинта,
 * который принимает вебхук, потому что величина окна зависит от интеграции.
 * Интерфейсу кассира это поле не даётся вовсе: возможность датировать чек
 * задним числом в руках кассира — это возможность занести покупку в окно
 * закончившейся акции.
 */
const occurredAtShape = {
  occurredAt: z.iso.datetime().optional(),
} as const

const originShape = {
  /** Канал, по которому операция пришла в систему. */
  source: LedgerSource,
  /** Класс инициатора. */
  actorType: ActorType,
  /** id сотрудника или гостя. У SYSTEM отсутствует. */
  actorId: z.uuid().optional(),
  /** Точка продаж, где всё произошло. */
  locationId: z.uuid().optional(),
  /** Зарегистрированное устройство кассы — без него PIN кассира не принимается. */
  deviceId: z.uuid().optional(),
  /** PII. Хранится ради антифрода, в логи не уходит. */
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
} as const

/** Ссылка на внешний объект: тип и id ходят только парой. */
const refShape = {
  refType: LedgerRefType.optional(),
  refId: z.string().trim().min(1).max(64).optional(),
} as const

/**
 * refType без refId (и наоборот) — полузаполненная ссылка, по которой потом невозможно
 * найти чек. Проверяем схемой, а не надеемся на дисциплину вызывающего.
 */
function hasCompleteRef(value: { refType?: unknown; refId?: unknown }): boolean {
  return (value.refType === undefined) === (value.refId === undefined)
}

const refIssue: { error: string; path: PropertyKey[] } = {
  error: 'refType и refId указываются только вместе',
  path: ['refId'],
}

/**
 * Вход LedgerService.earn — начисление баллов.
 *
 * Про знак. В журнале amount знаковое (плюс начисление, минус списание), но на входе
 * earn сумма всегда неотрицательная: начисление «минус двести» — это списание, и оно
 * обязано идти через redeem, чтобы попасть в правильные отчёты и лимиты кассира.
 *
 * Про ноль. amount: 0 разрешён сознательно: гость из контрольной группы
 * (Membership.isControlGroup) визит совершает, баллов не получает, но visitsTotal и
 * spentTotal обязаны сдвинуться — иначе доказать ROI программы будет нечем.
 */
export const EarnInput = z
  .object({
    /** Участие гостя в программе тенанта. tenantId и guestId сервис возьмёт сам. */
    membershipId: z.uuid(),
    /** Сколько баллов начислить. Неотрицательное целое, см. комментарий выше. */
    amount: MinorUnits,
    idempotencyKey: IdempotencyKey,
    /** Сумма чека в минорных единицах — база начисления и вклад в spentTotal. */
    basisAmount: MinorUnits.optional(),
    /** Если не передана — берётся Tenant.currency. Значение по умолчанию не зашито
     *  в контракт намеренно: валюта принадлежит тенанту, а не схеме. */
    currency: CurrencyCode.optional(),
    /** Акция, по которой начислено, если начисление породил движок правил. */
    offerId: z.uuid().optional(),
    /**
     * ЧТО продали, если заведение ведёт список видов продаж.
     *
     * Не подменяет refType: тот отвечает «чем запись вызвана» (чек, промокод,
     * реферал) и участвует в отмене чека и в отчётах по выручке. Здесь —
     * «что заведение продало»: абонемент, разовое занятие, товар.
     * Отсутствует — обычное дело: список ведут не все.
     */
    saleKindId: z.uuid().optional(),
    ...refShape,
    ...occurredAtShape,
    ...originShape,
  })
  .strict()
  .refine(hasCompleteRef, refIssue)

export type EarnInput = z.infer<typeof EarnInput>

/**
 * Вход LedgerService.redeem — списание баллов.
 *
 * amount здесь — модуль списания, строго положительное целое. Знак ставит сервис, а не
 * вызывающий: если бы вход принимал отрицательное число, рано или поздно кто-нибудь
 * передал бы модуль и списание превратилось бы в начисление.
 *
 * Ноль запрещён: списание нуля баллов не меняет баланс и только засоряет журнал.
 */
export const RedeemInput = z
  .object({
    membershipId: z.uuid(),
    /** Сколько баллов списать. Строго положительное целое. */
    amount: z.number().int().positive().max(INT32_MAX),
    idempotencyKey: IdempotencyKey,
    /** Сумма чека, к которому применено списание. */
    basisAmount: MinorUnits.optional(),
    /** Если не передана — берётся Tenant.currency. */
    currency: CurrencyCode.optional(),
    /** Акция или ваучер, по которому списываем. */
    offerId: z.uuid().optional(),
    /** Вид продажи, к которой применено списание. См. EarnInput. */
    saleKindId: z.uuid().optional(),
    ...refShape,
    ...occurredAtShape,
    ...originShape,
  })
  .strict()
  .refine(hasCompleteRef, refIssue)

export type RedeemInput = z.infer<typeof RedeemInput>

/**
 * Вход LedgerService.grant — баллы, которые гость получил не за покупку:
 * приветственные, ко дню рождения, за рекомендацию.
 *
 * Отличие от earn — не в знаке, а в счётчиках: визит и оборот не двигаются.
 * Приветственные баллы, записанные начислением, сделали бы из гостя, ни разу
 * не покупавшего, «гостя с визитом» — и испортили бы и статусы, и сравнение
 * с контрольной группой. Поэтому суммы чека во входе нет вовсе.
 *
 * Ноль запрещён: подарок в ноль баллов — пустая строка в журнале.
 */
export const GrantInput = z
  .object({
    membershipId: z.uuid(),
    /** Сколько баллов подарить. Строго положительное целое. */
    amount: z.number().int().positive().max(INT32_MAX),
    idempotencyKey: IdempotencyKey,
    /** Если не передана — берётся Tenant.currency. */
    currency: CurrencyCode.optional(),
    /** Акция, по которой подарено, если подарок породила акция. */
    offerId: z.uuid().optional(),
    ...refShape,
    ...originShape,
  })
  .strict()
  .refine(hasCompleteRef, refIssue)

export type GrantInput = z.infer<typeof GrantInput>

/**
 * Вход LedgerService.reverse — компенсация ранее проведённой операции.
 *
 * Суммы во входе нет намеренно. Компенсация равна исходной записи с обратным знаком,
 * и брать её значение снаружи — значит разрешить «отменить 500 из начисленных 200».
 * Сервис читает исходную запись внутри той же Serializable-транзакции.
 *
 * Правка исходной записи запрещена политикой Postgres: UPDATE и DELETE на LedgerEntry
 * заблокированы в базе. Отмена — только новая запись типа REVERSAL со ссылкой
 * reversalOfId на исходную.
 */
export const ReverseInput = z
  .object({
    /** Запись, которую компенсируем. Ложится в LedgerEntry.reversalOfId. */
    entryId: z.uuid(),
    /** Ключ самой компенсации: отдельная операция — отдельный ключ. */
    idempotencyKey: IdempotencyKey,
    reason: ReversalReason,
    /** Свободный текст для AuditLog. Обязателен при reason = OTHER. */
    comment: z.string().trim().min(1).max(COMMENT_MAX).optional(),
    ...originShape,
  })
  .strict()
  .refine((value) => value.reason !== 'OTHER' || value.comment !== undefined, {
    error: 'при причине OTHER комментарий обязателен',
    path: ['comment'],
  })

export type ReverseInput = z.infer<typeof ReverseInput>

/**
 * Запись журнала в том виде, в каком она уходит наружу.
 *
 * Отличие от входов: здесь .nullable(), а не .optional() — из базы приходит null, а не
 * отсутствующий ключ. Смешивать эти два состояния в одном контракте нельзя, иначе
 * клиент начнёт проверять и то и другое.
 */
export const LedgerEntryRecord = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    guestId: z.uuid(),
    membershipId: z.uuid(),

    type: LedgerType,
    /** ЗНАКОВОЕ: плюс — начисление, минус — списание. */
    amount: z.number().int().min(INT32_MIN).max(INT32_MAX),
    /** Снапшот баланса после операции. В минус баланс не уходит. */
    balanceAfter: MinorUnits,

    basisAmount: MinorUnits.nullable(),
    currency: CurrencyCode,

    source: LedgerSource,
    refType: LedgerRefType.nullable(),
    refId: z.string().nullable(),

    idempotencyKey: IdempotencyKey,
    reversalOfId: z.uuid().nullable(),
    offerId: z.uuid().nullable(),
    /** Что продали. Колонку обязан знать и выход: схема строгая, и запись
     *  журнала с неизвестным полем не пройдёт разбор вовсе. */
    saleKindId: z.uuid().nullable(),

    actorType: ActorType,
    actorId: z.uuid().nullable(),
    locationId: z.uuid().nullable(),
    deviceId: z.uuid().nullable(),
    /** PII — отдаётся только ролям, которым положено. */
    ip: z.string().nullable(),

    /** Когда мы об операции УЗНАЛИ. Неизменяемо. */
    createdAt: z.iso.datetime(),
    /**
     * Когда операция произошла, если это не совпадает с `createdAt`.
     * `null` — совпадает, то есть узнали в момент события.
     */
    occurredAt: z.iso.datetime().nullable(),
  })
  .strict()

export type LedgerEntryRecord = z.infer<typeof LedgerEntryRecord>

/**
 * Результат любой операции ledger.
 *
 * replayed: true означает, что запись с таким idempotencyKey уже существовала и вернулся
 * ПЕРВЫЙ результат, а не создалась вторая операция. Флаг нужен вызывающему: по нему
 * касса понимает, что повтор отработал, а не что операция прошла дважды.
 */
export const LedgerOperationResult = z
  .object({
    entry: LedgerEntryRecord,
    replayed: z.boolean(),
  })
  .strict()

export type LedgerOperationResult = z.infer<typeof LedgerOperationResult>
