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
  })
  .transform((raw) => ({
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    appVersion: raw.APP_VERSION,
    corsOrigins: resolveCorsOrigins(raw.CORS_ORIGINS, raw.NODE_ENV),
    accessTokenSecret: raw.ACCESS_TOKEN_SECRET ?? '',
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
