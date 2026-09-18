import { z } from 'zod'

/**
 * Гостевой контур: вход по коду и кошелёк.
 * docs/02, разделы 1.1–1.2 и 2.1.
 */

/** Канал доставки кода. SMS появится с провайдером; DEV — код в лог сервера. */
/**
 * Вход через аккаунт: гость нажимает кнопку у поставщика и приносит нам токен.
 *
 * Телефон при этом не спрашивается: ни один из поставщиков его не отдаёт,
 * а требовать номер отдельно значит вернуть трение, ради устранения которого
 * такой вход и добавлялся (docs/01, раздел 4.2).
 */
export const SocialProvider = z.enum(['GOOGLE', 'LINE', 'TELEGRAM'])

export type SocialProvider = z.infer<typeof SocialProvider>

export const SocialLoginInput = z
  .object({
    /**
     * Подписанный поставщиком токен. Длина ограничена сверху не для красоты:
     * без предела сюда можно прислать мегабайт и заставить сервер его разбирать.
     */
    idToken: z.string().min(16).max(8192),
  })
  .strict()

export type SocialLoginInput = z.infer<typeof SocialLoginInput>

/**
 * Вход из мини-приложения Telegram: карта гостя, открытая внутри мессенджера.
 * docs/02, раздел 1.4.
 *
 * ПРИЛОЖЕНИЕ НИЧЕГО НЕ РЕШАЕТ САМО. Оно передаёт строку `initData`, которую
 * Telegram положил в окно при открытии; кто её прислал и когда, решает подпись,
 * а проверяет её сервер ключом бота. Поэтому здесь нет ни имени, ни номера:
 * назваться кем угодно можно, подписаться — нет.
 *
 * Длина ограничена сверху: без предела сюда можно прислать мегабайт и заставить
 * сервер его разбирать (docs/05, раздел 4).
 */
export const TelegramMiniAppInput = z
  .object({
    initData: z.string().min(16).max(4096),
  })
  .strict()

export type TelegramMiniAppInput = z.infer<typeof TelegramMiniAppInput>

export const OtpChannel = z.enum(['DEV', 'SMS', 'TELEGRAM', 'LINE'])
export type OtpChannel = z.infer<typeof OtpChannel>

export const OtpRequestInput = z
  .object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Телефон в формате E.164, например +66812345678'),
    channel: OtpChannel.default('DEV'),
  })
  .strict()

export type OtpRequestInput = z.infer<typeof OtpRequestInput>

export const OtpRequestResult = z
  .object({
    requestId: z.uuid(),
    /** Секунды жизни кода. */
    expiresIn: z.number().int().positive(),
    /** Раньше этого не повторять запрос. */
    resendAfter: z.number().int().positive(),
    /**
     * Код подтверждения — ТОЛЬКО вне production, для разработки без SMS.
     * В боевом окружении поле отсутствует всегда; это проверяет тест.
     */
    devCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()

export type OtpRequestResult = z.infer<typeof OtpRequestResult>

export const OtpVerifyInput = z
  .object({
    requestId: z.uuid(),
    code: z.string().regex(/^\d{6}$/, 'Код — шесть цифр'),
  })
  .strict()

export type OtpVerifyInput = z.infer<typeof OtpVerifyInput>

export const GuestProfile = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    mode: z.enum(['TOURIST', 'RESIDENT']),
    locale: z.string().min(2).max(5),
  })
  .strict()

export type GuestProfile = z.infer<typeof GuestProfile>

export const GuestAuthResult = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive(),
    guest: GuestProfile,
    /** Гость создан этим входом — приветствие и онбординг показываются один раз. */
    isNew: z.boolean(),
  })
  .strict()

export type GuestAuthResult = z.infer<typeof GuestAuthResult>

export const GuestRefreshInput = z.object({ refreshToken: z.string().min(32).max(1024) }).strict()

export type GuestRefreshInput = z.infer<typeof GuestRefreshInput>

/** Участие в кошельке: заведение и баллы в нём. */
export const WalletMembership = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string().min(1),
    points: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    lastVisitAt: z.iso.datetime().nullable(),
    isControlGroup: z.boolean(),
    /**
     * Что сгорит ближайшим днём: сколько баллов и когда. null — не сгорает
     * ничего: у заведения нет срока жизни баллов или гость всё потратил.
     *
     * Гость должен узнать заранее, а не постфактум: сгоревшие молча баллы —
     * не экономия заведения, а обиженный человек у стойки.
     */
    expiring: z
      .object({ points: z.number().int().positive(), at: z.iso.datetime() })
      .strict()
      .nullable()
      .default(null),
    /** Статус гостя в заведении. null — лестницы статусов в заведении нет. */
    tier: z.object({ name: z.string() }).strict().nullable(),
    /**
     * Сколько осталось до следующего статуса — хватит любого из условий.
     * Суммы в минорных единицах. null — выше некуда, статус назначен вручную
     * или лестницы нет.
     */
    nextTier: z
      .object({
        name: z.string(),
        spentLeft: z.number().int().nonnegative().nullable(),
        visitsLeft: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .nullable(),
    /**
     * Баллы за приглашённого друга, в минорных единицах. null — приглашать здесь
     * незачем: заведение награду не включило или гость в группе сравнения.
     * Кнопка «Пригласить друга» показывается только при числе (docs/02, раздел 2.5).
     */
    inviteReward: z.number().int().positive().nullable(),
  })
  .strict()

export type WalletMembership = z.infer<typeof WalletMembership>

/**
 * Промокод в кошельке гостя. docs/02, раздел 2.1.
 *
 * Это подарок, который гость получил и ещё не потратил: партнёрская награда
 * от соседнего заведения или акция того, куда он ходит. Показывается ровно
 * то, что нужно у стойки: что дают, где, какой код и до какого числа.
 */
export const WalletVoucher = z
  .object({
    grantId: z.uuid(),
    offerId: z.uuid(),
    /** Заведение, где подарок действует. Не то, где его заработали. */
    tenantId: z.uuid(),
    venue: z.string().min(1),
    /** `null` — у акции нет названия. Код всё равно годен. */
    title: z.string().nullable(),
    /** Код, который гость показывает кассиру. */
    code: z.string().min(1),
    expiresAt: z.iso.datetime(),
    /**
     * Сколько дней осталось. Считает СЕРВЕР, а не приложение.
     *
     * Дело не в удобстве. Часы приложения — это часы телефона: их можно
     * перевести, они врут в роуминге и живут в чужом поясе. Срок подарка
     * решает заведение, и спорить у стойки гость будет с сервером, а не
     * со своим телефоном.
     *
     * Ноль — истекает сегодня. Отрицательных не бывает: просроченные
     * в кошелёк не попадают вовсе.
     */
    expiresInDays: z.number().int().nonnegative(),
    /**
     * Как воспользоваться, по шагам. Приходит С СЕРВЕРА, а не собирается
     * на клиенте: иначе четыре языка Пхукета разъедутся между приложениями.
     */
    howTo: z.array(z.string()),
  })
  .strict()

export type WalletVoucher = z.infer<typeof WalletVoucher>

export const GuestWallet = z
  .object({
    /** Сумма баллов по всем заведениям — крупная цифра на карте. */
    totalPoints: z.number().int(),
    memberships: z.array(WalletMembership),
    /**
     * Непотраченные промокоды. Пустой список — норма.
     *
     * Погашенные и просроченные сюда не попадают: кошелёк отвечает на вопрос
     * «что я могу получить сейчас», а не «что у меня когда-то было». История
     * подарков — отдельный экран, которого пока нет.
     */
    vouchers: z.array(WalletVoucher),
  })
  .strict()

export type GuestWallet = z.infer<typeof GuestWallet>

export const GuestMe = GuestProfile.extend({
  /** Маскированный телефон: «+66 •• •• 4821». Полный гостю не нужен — он свой знает. */
  /** null — гость вошёл через аккаунт и номер не оставлял. */
  phoneMasked: z.string().min(1).nullable(),
  /** День рождения, `YYYY-MM-DD`. null — не указан (docs/02, раздел 2.7). */
  birthday: z.iso.date().nullable(),
}).strict()

export type GuestMe = z.infer<typeof GuestMe>

/** Токен для показа на кассе. */
export const GuestQrToken = z
  .object({
    token: z.string().min(1),
    expiresIn: z.number().int().positive(),
  })
  .strict()

export type GuestQrToken = z.infer<typeof GuestQrToken>

/**
 * Вход через Telegram. docs/02, раздел 1 — третий способ рядом с кодом и Google.
 *
 * ПОЧЕМУ НЕ ТАК, КАК У GOOGLE. У Google гость нажимает кнопку прямо на странице
 * и приносит нам подписанный токен одним движением. Telegram так тоже умеет
 * (Login Widget), но виджет привязан к домену, зарегистрированному у бота,
 * а внутри мобильного приложения адрес страницы — `https://localhost`.
 * Ровно об эту стену уже разбился вход через Google в приложении.
 *
 * Поэтому здесь другой обмен: сервер выдаёт одноразовую ссылку на бота, гость
 * открывает её в Telegram и нажимает «Запустить», бот сообщает серверу, кто
 * это был, а приложение тем временем спрашивает: «уже?». Домен в этом обмене
 * не участвует вовсе — работает и на сайте, и в приложении.
 *
 * ПОБОЧНАЯ ВЫГОДА, РАДИ КОТОРОЙ ВСЁ И ЗАТЕВАЛОСЬ. Гость, нажавший «Запустить»,
 * тем самым разрешил боту себе писать. То есть вместе со входом мы получаем
 * бесплатный канал доставки — тот самый, которым по ТЗ должны уходить коды
 * и уведомления вместо платных SMS (docs/02, раздел 1.1).
 */
export const TelegramLoginStartResult = z
  .object({
    requestId: z.uuid(),
    /**
     * Одноразовый секрет, которым приложение доказывает, что вход начало оно.
     *
     * Без него любой, кто угадал бы `requestId`, забрал бы чужую сессию:
     * подтверждение приходит от бота, а не от того, кто спрашивает результат.
     */
    claimSecret: z.string().min(32).max(128),
    /** Ссылка вида `https://t.me/<бот>?start=<одноразовый код>`. */
    url: z.url(),
    /** Секунды жизни ссылки. */
    expiresIn: z.number().int().positive(),
    /** Не спрашивать результат чаще, чем раз в столько секунд. */
    pollAfter: z.number().int().positive(),
  })
  .strict()

export type TelegramLoginStartResult = z.infer<typeof TelegramLoginStartResult>

export const TelegramClaimInput = z
  .object({
    requestId: z.uuid(),
    claimSecret: z.string().min(32).max(128),
  })
  .strict()

export type TelegramClaimInput = z.infer<typeof TelegramClaimInput>

/**
 * `PENDING` — гость ещё не нажал «Запустить». `READY` — вошёл, токены в ответе.
 * `EXPIRED` — ссылка протухла, сессия уже забрана или секрет не подошёл.
 *
 * Три причины `EXPIRED` намеренно неразличимы снаружи: по разнице ответов
 * видно, существует ли запрос с таким идентификатором.
 */
export const TelegramLoginState = z.enum(['PENDING', 'READY', 'EXPIRED'])

export type TelegramLoginState = z.infer<typeof TelegramLoginState>

export const TelegramClaimResult = z
  .object({
    state: TelegramLoginState,
    /** Заполнено только при `READY`, и только один раз: сессия забирается однократно. */
    session: GuestAuthResult.nullable(),
  })
  .strict()

export type TelegramClaimResult = z.infer<typeof TelegramClaimResult>
