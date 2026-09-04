import { Injectable, Logger } from '@nestjs/common'
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'

import { getEnv } from '../common/config/env'
import { PrismaClient } from '../generated/prisma/client'
import type { Prisma } from '../generated/prisma/client'

/**
 * PrismaClient, завёрнутый в провайдер Nest.
 *
 * Жизненный цикл. Соединение открывается на `onModuleInit` и закрывается на
 * `onModuleDestroy`. Второе работает только потому, что в `main.ts` вызван
 * `app.enableShutdownHooks()`: без него Nest не подписывается на SIGTERM, и Railway
 * при деплое убивал бы процесс с открытым пулом посреди транзакции.
 *
 * Почему driver adapter. В Prisma 7 блок `datasource` больше не принимает `url`:
 * строка подключения приходит из `prisma.config.ts` для CLI и из адаптера — для
 * рантайма. Отсюда `@prisma/adapter-pg`, а не «магическая» переменная окружения
 * внутри клиента.
 */

/** Видно в pg_stat_activity: понятно, чьи соединения висят в базе. */
const APPLICATION_NAME = 'positive-loyalty-api'

const POSTGRES_SCHEMES = ['postgres:', 'postgresql:']

/**
 * Разбирает строку подключения.
 *
 * Значение наружу не отдаётся никогда: в строке лежит пароль, а он не попадает
 * ни в логи, ни в тексты ошибок (docs/05, раздел 10). Поэтому сообщения об ошибке
 * называют переменную, но не показывают её содержимое.
 *
 * Политика отсутствующей переменной различается по окружению — ровно как у
 * CORS_ORIGINS в `common/config/env.ts`:
 *
 *   • production — падаем на старте. API без базы не работает, и узнать об этом
 *     на первом чеке в кассе хуже, чем на деплое;
 *   • dev, test и CI — переменной может не быть вовсе (в CI её и нет), и это не
 *     повод ронять процесс: /health обязан отвечать без базы. Ошибку пишем в лог,
 *     а первое же обращение к базе честно упадёт на соединении.
 *
 * Кривая строка — ошибка в любом окружении: опечатка остаётся опечаткой и на CI.
 *
 * TODO(Задача 3): когда `common/config/env.ts` обзаведётся секцией базы, перенести
 * разбор туда — разбор окружения должен жить в одном месте.
 */
const readRawDatabaseUrl = (): string | undefined => {
  const raw = process.env.DATABASE_URL?.trim()
  return raw === undefined || raw.length === 0 ? undefined : raw
}

const resolveDatabaseUrl = (): string | undefined => {
  const raw = readRawDatabaseUrl()

  if (raw === undefined) {
    if (getEnv().nodeEnv === 'production') {
      throw new Error(
        'Некорректная конфигурация окружения — DATABASE_URL обязателен в production: ' +
          'API не поднимается без строки подключения к PostgreSQL',
      )
    }

    return undefined
  }

  let scheme: string

  try {
    scheme = new URL(raw).protocol
  } catch {
    throw new Error('Некорректная конфигурация окружения — DATABASE_URL не является URL')
  }

  if (!POSTGRES_SCHEMES.includes(scheme)) {
    throw new Error(
      'Некорректная конфигурация окружения — DATABASE_URL должен начинаться с postgresql://',
    )
  }

  return raw
}

/**
 * Опции клиента.
 *
 * `log: ['error']` — сознательное ограничение. Уровень `query` печатает SQL вместе со
 * связанными параметрами, а среди них телефоны гостей и коды подтверждения; это прямое
 * нарушение железного правила 5 (CLAUDE.md). Включать его можно только точечно и только
 * локально, никогда не в общей конфигурации.
 *
 * `errorFormat: 'minimal'` — по той же причине: `pretty` подставляет в текст ошибки
 * значения аргументов запроса.
 */
/**
 * Настройки подключения, зависящие от схемы.
 *
 * Вынесено чистой функцией ради проверяемости: схема обязана доехать до базы
 * двумя РАЗНЫМИ путями, и перепутать их местами легко, а заметить — нет.
 */
export interface SchemaBoundConfig {
  /**
   * Конфигурация пула pg. `options` задаёт search_path соединения.
   *
   * `connectionString` может быть `undefined`: вне production адрес базы
   * не обязателен, и pg в этом случае берёт стандартные переменные PG*.
   * Обязательность проверяется отдельно в `resolveDatabaseUrl`.
   */
  readonly poolConfig: {
    connectionString: string | undefined
    application_name: string
    options: string
  }
  /** Опции адаптера Prisma. Влияют на запросы, которые Prisma генерирует сама. */
  readonly adapterOptions: { schema: string }
}

/**
 * СХЕМА ЗАДАЁТСЯ В ДВУХ МЕСТАХ, И ОБА ОБЯЗАТЕЛЬНЫ — это не дублирование.
 *
 * Запросы, которые Prisma генерирует сама, берут схему из опции адаптера.
 * Проверено снятием SQL с компилятора: без неё в каждый идентификатор
 * зашивается литерал `public` — не «резолвится по search_path», а именно
 * зашивается. Поэтому настройка search_path на роли такую сборку не чинит.
 *
 * Сырой SQL (`$queryRaw`) уходит в драйвер как есть и разрешается уже
 * по `search_path` соединения. Опция адаптера на него не влияет вовсе.
 *
 * Пропуск любой из двух настроек даёт ТИХИЙ отказ на базе, общей с чужим
 * продуктом: часть запросов уходит в чужую схему, часть в нашу, и никто
 * не падает.
 */
export const buildSchemaBoundConfig = (
  connectionString: string | undefined,
  schema: string,
): SchemaBoundConfig => ({
  poolConfig: {
    connectionString,
    application_name: APPLICATION_NAME,
    // Имя схемы уже проверено схемой окружения на соответствие идентификатору,
    // поэтому подстановка безопасна.
    //
    // `public` в хвосте намеренно: расширения (pgcrypto, uuid-ossp) ставятся
    // туда, и без него отвалились бы вызовы их функций. Наша схема стоит
    // ПЕРВОЙ — при совпадении имён выигрывает она.
    options: `-c search_path=${schema},public`,
  },
  adapterOptions: { schema },
})

const createClientOptions = (): ConstructorParameters<typeof PrismaClient>[0] => {
  const { poolConfig, adapterOptions } = buildSchemaBoundConfig(
    resolveDatabaseUrl(),
    getEnv().databaseSchema,
  )

  return {
    adapter: new PrismaPg(poolConfig, adapterOptions),
    log: ['error'],
    errorFormat: 'minimal',
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    // Разбор конфигурации внутри аргумента super(), а не отдельной строкой выше:
    // так конструктор остаётся тривиальным, а неверная конфигурация роняет процесс
    // на этапе создания провайдера, до того как порт начнёт слушаться.
    super(createClientOptions())
  }

  async onModuleInit(): Promise<void> {
    if (readRawDatabaseUrl() === undefined) {
      // Сюда попадаем только вне production: resolveDatabaseUrl() уже отработал.
      this.logger.error(
        'DATABASE_URL не задан — обращения к базе будут падать на соединении. ' +
          'Для локальной работы скопируйте .env.example в .env',
      )
      return
    }

    // $connect у driver adapter поднимает пул, но сокет открывает лениво — первым
    // запросом. То есть это НЕ проба доступности базы: если Postgres лежит, узнаем
    // об этом на первом запросе, а не здесь. Настоящая проба (SELECT 1) — дело
    // readiness-эндпоинта, она приедет вместе с расширением /health.
    await this.$connect()
    this.logger.log('Пул соединений с PostgreSQL создан')
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
    this.logger.log('Соединение с PostgreSQL закрыто')
  }

  /**
   * Рубеж 2 из docs/01, раздел 5: выполняет работу под включённым RLS.
   *
   * ПОЧЕМУ ОБЯЗАТЕЛЬНО ТРАНЗАКЦИЯ. Политики читают `current_setting('app.tenant_id')`,
   * а выставить её можно только через `SET LOCAL` — то есть внутри транзакции.
   * Обычный `SET` привязан к соединению, а соединения берутся из пула и возвращаются
   * туда же: следующий запрос другого тенанта получил бы чужое значение. Это не
   * теоретический риск, а самый частый способ сломать RLS в связке с пулером.
   *
   * `set_config(..., true)` — тот же `SET LOCAL` в виде функции: третий аргумент
   * `is_local = true` означает «до конца транзакции».
   *
   * Цена — транзакция на каждое чтение. Она осознанная: без неё политики не
   * применяются вовсе, а «RLS включён, но не действует» хуже отсутствующего RLS,
   * потому что создаёт ложную уверенность.
   */
  async forTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tenantId.trim().length === 0) {
      throw new Error(
        'forTenant вызван без tenantId. Пустое значение выключило бы политики RLS ' +
          'и вернуло данные всех заведений сразу.',
      )
    }

    return this.$transaction(async (tx) => {
      // Параметризованный вызов, а не интерполяция в строку: tenantId приходит из
      // токена, но подставлять его в SQL текстом всё равно нельзя.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })
  }
  /**
   * Гостевой контур RLS: работа от имени гостя.
   *
   * Зеркало forTenant для второго контура политик (миграция 20260826230000):
   * гость видит свой профиль, свои участия во всех заведениях и свою историю.
   * Тот же механизм SET LOCAL в транзакции — и по тем же причинам: значение
   * не должно пережить транзакцию и утечь следующему запросу из пула.
   */
  async forGuest<T>(guestId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (guestId.trim().length === 0) {
      throw new Error(
        'forGuest вызван без guestId. Пустое значение выключило бы политики гостевого контура.',
      )
    }

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.guest_id', ${guestId}, true)`
      return fn(tx)
    })
  }
}
