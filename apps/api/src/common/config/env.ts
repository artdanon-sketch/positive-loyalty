import { z } from 'zod'

/**
 * Разбор переменных окружения.
 *
 * Правило: неправильная конфигурация должна ронять процесс на старте, а не через час
 * под нагрузкой. Поэтому парсим один раз при загрузке и бросаем исключение.
 *
 * PII и секреты в сообщение об ошибке не попадают: наружу отдаём только имена переменных
 * и причину, но никогда — значения (docs/05_Безопасность_и_антифрод.md, раздел 10).
 */

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'] as const

const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

/**
 * В production список origin задаётся только явно: молча подставленный localhost —
 * это дыра, которую никто не заметит до инцидента.
 */
const resolveCorsOrigins = (raw: string | undefined, nodeEnv: NodeEnv): string[] => {
  if (raw !== undefined) {
    return splitList(raw)
  }

  return nodeEnv === 'production' ? [] : [...DEV_CORS_ORIGINS]
}

export const NodeEnv = z.enum(['development', 'test', 'production'])
export type NodeEnv = z.infer<typeof NodeEnv>

const EnvSchema = z
  .object({
    NODE_ENV: NodeEnv.default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Список origin через запятую. В production обязателен: подставлять localhost нельзя. */
    CORS_ORIGINS: z.string().optional(),
    /** Версия сборки, её отдаёт /health. Railway прокидывает сюда номер релиза. */
    APP_VERSION: z.string().min(1).default('0.0.0'),
    /**
     * Секрет подписи access-токенов. Из него берётся tenantId — то есть от него
     * напрямую зависит изоляция заведений: подобрал секрет, выписал себе токен
     * с чужим tenantId. Минимум 32 символа, в production обязателен.
     */
    ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
    /**
     * Схема базы, в которой живёт система лояльности.
     *
     * ЗАЧЕМ ОТДЕЛЬНАЯ ПЕРЕМЕННАЯ. База может быть общей с другим продуктом:
     * у нашей стороны своя схема, у соседа своя. Prisma в этом случае обязана
     * знать имя схемы ЯВНО — драйвер-адаптер без него зашивает в каждый
     * идентификатор литерал `public`, и запросы уходят к соседу, а не к нам.
     * Отказ при этом тихий: если старые таблицы остались в public, приложение
     * молча продолжает читать и писать туда.
     *
     * По умолчанию `public` — ровно сегодняшнее поведение. Переезд на свою
     * схему это отдельный осознанный шаг, а не побочный эффект обновления.
     */
    DATABASE_SCHEMA: z
      .string()
      .regex(
        /^[a-z_][a-z0-9_$]*$/,
        'должно быть идентификатором схемы PostgreSQL в нижнем регистре',
      )
      .default('public'),

    /**
     * Корневой сертификат сервера базы, целиком, в формате PEM.
     *
     * ЗАЧЕМ. Соединение с облачной базой обязано быть зашифровано: иначе пароль
     * и данные гостей идут через интернет открытым текстом. Проверено на живой
     * базе — Supabase пускает и без шифрования, а драйвер по умолчанию его
     * не просит, и никто об этом не сообщает.
     *
     * Шифрование включается всегда, когда база не на этой машине. А вот
     * ПРОВЕРИТЬ, что на том конце действительно она, можно только имея её
     * сертификат: у Supabase он подписан их собственным центром, которого нет
     * в системном списке доверенных.
     *
     * Пусто — шифрование есть, проверки подлинности нет. Это защищает
     * от подслушивания, но не от подмены сервера. Задан — есть и то, и другое.
     */
    DATABASE_SSL_CA: z.string().optional(),

    /**
     * Идентификатор приложения в Google — тот же, что стоит на кнопке входа.
     *
     * СЕКРЕТОМ НЕ ЯВЛЯЕТСЯ: он попадает в код страницы и виден любому. Секрет
     * приложения (client secret) здесь не нужен вовсе — выбран способ входа,
     * где подпись токена проверяется открытыми ключами Google.
     *
     * Зато он ОБЯЗАТЕЛЕН для проверки: в токене есть поле «для кого выписан»,
     * и сверять его не с чем, если идентификатор неизвестен. Тогда подошёл бы
     * любой токен Google, выданный любому другому сайту. Поэтому пусто —
     * значит вход через Google выключен целиком, а не «работает как-нибудь».
     */
    GOOGLE_CLIENT_ID: z.string().optional(),

    /**
     * Ключ бота Telegram — тот, что выдал `@BotFather`.
     *
     * ЭТО НАСТОЯЩИЙ СЕКРЕТ, в отличие от идентификатора Google выше. Кто им
     * владеет — читает всю переписку бота и пишет от его имени. В лог он
     * не попадает никогда, в ответы API — тем более.
     *
     * Формат проверяем здесь же, а не при первом обращении к Telegram:
     * опечатка в переменной окружения должна ронять процесс на старте,
     * а не превращаться в непонятный отказ входа через неделю.
     *
     * Пусто — вход через Telegram выключен целиком.
     */
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'не похоже на ключ бота: ожидается «<число>:<строка>»')
      .optional(),
  })
  .transform((raw) => ({
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    appVersion: raw.APP_VERSION,
    corsOrigins: resolveCorsOrigins(raw.CORS_ORIGINS, raw.NODE_ENV),
    accessTokenSecret: raw.ACCESS_TOKEN_SECRET ?? '',
    databaseSchema: raw.DATABASE_SCHEMA,
    databaseSslCa: raw.DATABASE_SSL_CA?.trim() === '' ? undefined : raw.DATABASE_SSL_CA,
    googleClientId: raw.GOOGLE_CLIENT_ID?.trim() ?? '',
    telegramBotToken: raw.TELEGRAM_BOT_TOKEN?.trim() ?? '',
  }))
  .superRefine((env, ctx) => {
    if (env.nodeEnv === 'production' && env.accessTokenSecret.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ACCESS_TOKEN_SECRET'],
        message:
          'обязателен в production: без него нечем проверить подпись токена, ' +
          'а значит нечем подтвердить tenantId',
      })
    }
  })

export type Env = z.infer<typeof EnvSchema>

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const key = issue.path.join('.')
      return key.length > 0 ? `${key}: ${issue.message}` : issue.message
    })
    .join('; ')

/**
 * Разбирает произвольный источник переменных. Значения наружу не логируются.
 *
 * @throws Error если конфигурация некорректна.
 */
export const loadEnv = (source: Record<string, unknown> = process.env): Env => {
  const parsed = EnvSchema.safeParse(source)

  if (!parsed.success) {
    throw new Error(`Некорректная конфигурация окружения — ${describeIssues(parsed.error)}`)
  }

  if (parsed.data.nodeEnv === 'production' && parsed.data.corsOrigins.length === 0) {
    throw new Error(
      'Некорректная конфигурация окружения — CORS_ORIGINS обязателен в production: ' +
        'браузерные клиенты допускаются только по явному списку доменов',
    )
  }

  return parsed.data
}

let cache: Env | undefined

/** Мемоизированный доступ к конфигурации процесса. */
export const getEnv = (): Env => {
  cache ??= loadEnv(process.env)
  return cache
}

/** Сброс кэша между тестами. В рантайме не используется. */
export const resetEnvCache = (): void => {
  cache = undefined
}
