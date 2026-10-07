/**
 * Загрузка боевого рантайма API в обычный node-процесс.
 *
 * Зачем это вообще нужно. Железное правило 1 (CLAUDE.md) говорит: баллы меняются
 * только через `LedgerService`. Значит, и seed, и демо-скрипт продаж обязаны звать
 * тот же самый сервис, а не «почти такую же» логику рядом. Второй реализации
 * Serializable-транзакции с ретраем в репозитории быть не должно — сверка однажды
 * разойдётся именно между ними.
 *
 * Почему через `dist`, а не напрямую из исходников. Скрипты в `prisma/` запускаются
 * обычным `node --experimental-strip-types`: он вырезает типы, но НЕ умеет
 * трансформировать TypeScript-синтаксис, требующий кодогенерации. А в
 * `apps/api/src/core/ledger.service.ts` есть и то, и другое:
 *
 *   • `@Injectable()` — декоратор, V8 такой синтаксис не парсит;
 *   • `constructor(private readonly prisma: PrismaService)` — parameter property,
 *     node падает с ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 *
 * То же самое с клиентом Prisma 7: генератор кладёт в `apps/api/src/generated/prisma`
 * TypeScript-исходники, а `apps/api` — CommonJS, и node читает эти `.ts` как CommonJS,
 * спотыкаясь на `import` внутри них.
 *
 * Поэтому берём то, что уже собрал `nest build`: `apps/api/dist` — обычный CommonJS,
 * который ESM-скрипт импортирует без единого костыля. Типы при этом приезжают из
 * ИСХОДНИКОВ через `import type` (в рантайме такие импорты стираются целиком), так что
 * strict-типизация сохраняется и `any` здесь нет.
 *
 * Цена решения: перед запуском нужен собранный API. Скрипты `db:seed` и `demo:sales`
 * в корневом package.json собирают его сами; если сюда пришли мимо них — ниже честная
 * ошибка с командой, а не «cannot find module».
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { LedgerEventsService } from '../apps/api/src/core/ledger-events.service.ts'
import type { LedgerService } from '../apps/api/src/core/ledger.service.ts'
import type { PrismaService } from '../apps/api/src/core/prisma.service.ts'

/** Корень собранного API. Слеш в конце обязателен: иначе `new URL` съест сегмент. */
const DIST_ROOT = new URL('../apps/api/dist/', import.meta.url)

/** package.json приложения — точка, от которой резолвятся его зависимости. */
const API_PACKAGE_JSON = new URL('../apps/api/package.json', import.meta.url)

const PRISMA_SERVICE_MODULE = new URL('core/prisma.service.js', DIST_ROOT)
const LEDGER_SERVICE_MODULE = new URL('core/ledger.service.js', DIST_ROOT)
const PIN_MODULE = new URL('auth/pin.js', DIST_ROOT)
const MASK_MODULE = new URL('common/pii/mask-phone.js', DIST_ROOT)

const BUILD_COMMAND = 'pnpm --filter @positive/api run build'

/** Форма модулей `dist`, которые нам нужны. Ровно два конструктора, не больше. */
interface PrismaServiceModule {
  readonly PrismaService: new () => PrismaService
}

/** Журналу нужна живая лента — но от неё он зовёт ровно одно. */
type LedgerFeed = Pick<LedgerEventsService, 'publishEarned'>

interface LedgerServiceModule {
  readonly LedgerService: new (prisma: PrismaService, events: LedgerFeed) => LedgerService
}

/**
 * Живая лента бэк-офиса: у seed и демо-продаж её слушать некому.
 *
 * Настоящий `LedgerEventsService` на каждый чек ходил бы в базу за именем гостя
 * ради экрана, которого нет, — тысячи лишних запросов за 90 дней истории. А без
 * ленты вовсе журнал падал на первом же чеке: `publishEarned` у `undefined`.
 */
const SILENT_FEED: LedgerFeed = {
  publishEarned: () => undefined,
}

/** Хеширование PIN — та же реализация, что проверяет вход. Второй быть не должно. */
interface PinModule {
  readonly hashPin: (pin: string) => Promise<string>
}

/**
 * Маскирование телефона — та же реализация, что у API.
 *
 * Своя копия здесь уже была, и она успела разойтись: прятала последние цифры,
 * а показывала первые, то есть открывала на экране больше номера, чем остальные
 * три. Расхождения такого рода не замечают, пока однажды не окажется, что
 * персональные данные утекли из самого безобидного места.
 */
interface MaskModule {
  readonly maskPhone: (e164: string | null | undefined) => string | null
}

/**
 * Статическая часть `Logger` из @nestjs/common — только то, чем мы пользуемся.
 * Полный тип сюда тянуть незачем: @nestjs/common не зависимость корня.
 */
interface NestCommonModule {
  readonly Logger: { overrideLogger(levels: readonly string[]): void }
}

/** Рантайм API, готовый к работе. */
export interface ApiRuntime {
  /** Клиент базы. Читать — сколько угодно; писать баллы — только через `ledger`. */
  readonly prisma: PrismaService
  /** Единственная точка изменения баллов в системе. */
  readonly ledger: LedgerService
  /** Хеш PIN тем же scrypt, которым API проверяет вход. */
  readonly hashPin: (pin: string) => Promise<string>
  /** Маска телефона тем же способом, каким её строит API. */
  readonly maskPhone: (e164: string | null | undefined) => string | null
  /** Закрыть пул соединений. Без этого процесс висит после последнего запроса. */
  readonly close: () => Promise<void>
}

const assertBuilt = (): void => {
  const missing = [PRISMA_SERVICE_MODULE, LEDGER_SERVICE_MODULE, PIN_MODULE, MASK_MODULE].filter(
    (module) => !existsSync(fileURLToPath(module)),
  )

  if (missing.length === 0) {
    return
  }

  throw new Error(
    'API не собран: в apps/api/dist нет ядра (core/prisma.service.js, core/ledger.service.js). ' +
      `Соберите его командой «${BUILD_COMMAND}» и повторите запуск. ` +
      'Скрипты pnpm db:seed и pnpm demo:sales делают это сами.',
  )
}

/**
 * Приглушает логгер Nest до уровня предупреждений.
 *
 * `LedgerService` пишет в лог каждую операцию уровнем debug и каждый повтор по ключу —
 * уровнем log. Для сервера это правильно, для скрипта, чей вывод показывают владельцу
 * бизнеса, — семьдесят строк служебного шума поверх таблицы.
 *
 * Уровни `error` и `warn` НЕ глушим сознательно: расхождение кэша с журналом и
 * конфликт сериализации обязаны быть видны, это не косметика.
 */
const quietNestLogger = (): void => {
  const requireFromApi = createRequire(API_PACKAGE_JSON)
  const nest = requireFromApi('@nestjs/common') as NestCommonModule

  nest.Logger.overrideLogger(['error', 'warn'])
}

/**
 * Поднимает `PrismaService` и `LedgerService` без контейнера Nest.
 *
 * DI здесь не нужен: зависимости обоих классов передаются конструктором — базе
 * и журналу, а журналу ещё и лента (здесь — тихая, см. SILENT_FEED).
 * `@Injectable()` — это метаданные для контейнера, созданию объекта руками он не мешает.
 *
 * `$connect` не зовём: driver adapter поднимает пул лениво, первым же запросом.
 * Отсутствующий или неверный DATABASE_URL честно упадёт на первом обращении к базе,
 * а не «где-то в середине».
 */
export const loadApiRuntime = async (): Promise<ApiRuntime> => {
  assertBuilt()
  quietNestLogger()

  const prismaModule = (await import(PRISMA_SERVICE_MODULE.href)) as PrismaServiceModule
  const ledgerModule = (await import(LEDGER_SERVICE_MODULE.href)) as LedgerServiceModule
  const pinModule = (await import(PIN_MODULE.href)) as PinModule
  const maskModule = (await import(MASK_MODULE.href)) as MaskModule

  const prisma = new prismaModule.PrismaService()
  const ledger = new ledgerModule.LedgerService(prisma, SILENT_FEED)

  return {
    prisma,
    ledger,
    hashPin: pinModule.hashPin,
    maskPhone: maskModule.maskPhone,
    close: async () => {
      await prisma.$disconnect()
    },
  }
}
