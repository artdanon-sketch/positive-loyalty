import 'reflect-metadata'

import { Logger, Module, RequestMethod } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { ZodValidationPipe } from 'nestjs-zod'

import { getEnv } from './common/config/env'
import { PlatformHealthController } from './platform/platform-health.controller'
import { PlatformModule } from './platform/platform.module'

/**
 * Точка входа админки платформы — ОТДЕЛЬНЫЙ ПРОЦЕСС.
 *
 * ─── ЧТО ЗДЕСЬ ОТДЕЛЬНОГО, А ЧТО ОБЩЕЕ ───────────────────────────────────────
 *
 * Общий у двух приложений — исходный код: они живут в одном репозитории и
 * собираются одной сборкой. Разделено то, что решает:
 *
 *   процесс          свой, со своим портом и своим деплоем на Railway;
 *   роль Postgres    positive_platform, а не positive_app;
 *   секрет токенов   PLATFORM_ACCESS_TOKEN_SECRET, а не ACCESS_TOKEN_SECRET;
 *   набор маршрутов  только /v1/platform/*, ни одного маршрута заведений.
 *
 * Разделять ещё и кодовую базу пришлось бы ценой вытаскивания в общий пакет
 * половины ядра: хеширования паролей, клиента Prisma, аудита. Это большой
 * рефакторинг рядом с новой функциональностью — то есть ровно тот размен,
 * от которого предостерегает CLAUDE.md.
 *
 * И главное: разделение кодовой базы НИЧЕГО не добавило бы к безопасности.
 * Утечку данных предотвращают учётные данные, а не расположение файлов.
 * Процесс, обслуживающий владельцев ресторанов, физически не может прочитать
 * чужое заведение — не потому, что у него нет такого кода, а потому, что его
 * роль в базе этого не умеет.
 *
 * ─── ПОЧЕМУ ЗДЕСЬ НЕТ CoreModule ─────────────────────────────────────────────
 *
 * В нём PrismaService на роли positive_app, LedgerService и живая лента
 * бэк-офиса. Ничего из этого админке платформы не нужно, а лишний пул
 * соединений под обычной ролью в этом процессе — именно то, чего мы избегаем.
 */

const HEALTH_ROUTE = 'health'
const GLOBAL_PREFIX = 'v1'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PlatformModule],
  controllers: [PlatformHealthController],
})
class PlatformAppModule {}

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(PlatformAppModule)
  const env = getEnv()

  app.use(helmet())

  // Тот же довод, что в main.ts: без этого за обратным прокси все клиенты
  // выглядят одним адресом, и любое ограничение по адресу превращается
  // в ограничение на всех сразу.
  app.set('trust proxy', 1)

  // CORS по тому же списку доменов, что и у основного API. Отдельный список
  // для панели появится, когда у неё появится собственный домен.
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    maxAge: 600,
  })

  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [{ path: HEALTH_ROUTE, method: RequestMethod.GET }],
  })

  app.useGlobalPipes(new ZodValidationPipe())
  app.enableShutdownHooks()

  await app.listen(env.port, '0.0.0.0')

  new Logger('PlatformBootstrap').log(
    `Админка платформы слушает 0.0.0.0:${env.port} · окружение ${env.nodeEnv}`,
  )
}

bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
  new Logger('PlatformBootstrap').error(`Запуск админки платформы не удался — ${reason}`)
  process.exit(1)
})
