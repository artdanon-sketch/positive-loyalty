import 'reflect-metadata'

import { Logger, RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { ZodValidationPipe } from 'nestjs-zod'

import { AppModule } from './app.module'
import { assertMigrated } from './common/config/assert-migrated'
import { getEnv } from './common/config/env'
import { PrismaService } from './core/prisma.service'

const HEALTH_ROUTE = 'health'
const GLOBAL_PREFIX = 'v1'

const bootstrap = async (): Promise<void> => {
  // `rawBody` — ради подписи вебхуков от кассы. Она считается по СЫРЫМ БАЙТАМ
  // тела: разобранный и снова собранный JSON даёт другой порядок ключей
  // и другие пробелы, и хеш не сходится (docs/02, раздел 4.1).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })

  // ConfigModule уже подтянул .env в process.env, поэтому разбор окружения — здесь.
  // Некорректная конфигурация роняет процесс до того, как порт начнёт слушаться.
  const env = getEnv()

  // Секрет подписи токенов ЭТОГО контура.
  //
  // Проверка стоит здесь, а не в общей схеме настроек, и это переезд, а не
  // упущение. Процессов стало два: админка платформы читает те же настройки
  // ради схемы базы, но подписывает свои токены ДРУГИМ секретом. Останься
  // проверка общей, ей пришлось бы выдать и ACCESS_TOKEN_SECRET — то есть
  // вручить процессу, видящему все заведения, ключ от токенов владельцев.
  //
  // Каждый процесс требует ровно те секреты, которыми пользуется сам.
  if (env.nodeEnv === 'production' && env.accessTokenSecret.length === 0) {
    throw new Error(
      'Некорректная конфигурация окружения — ACCESS_TOKEN_SECRET обязателен ' +
        'в production: без него нечем проверить подпись токена, а значит ' +
        'нечем подтвердить tenantId',
    )
  }

  app.use(helmet())

  // Адрес клиента берём из заголовка ближайшего прокси.
  //
  // ЗАЧЕМ. На Railway (и за любым обратным прокси) запрос приходит от прокси,
  // и без этой строки все клиенты выглядят одним адресом. Любое ограничение
  // «столько-то попыток с адреса» тогда молча превращается в ограничение
  // на всех сразу — то есть в отказ в обслуживании вместо защиты от него.
  //
  // ЕДИНИЦА, А НЕ `true`. Доверяем ровно одному ближайшему прокси и берём
  // адрес, который проставил он. `true` доверял бы всей цепочке заголовка,
  // а её начало пишет сам клиент — то есть подделывается свободно.
  app.set('trust proxy', 1)

  // CORS только по явному списку доменов (docs/05_Безопасность_и_антифрод.md, раздел 9).
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      'Accept-Language',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  })

  // Версионируем всё, кроме health: на /health смотрит healthcheck Railway,
  // и он не должен переезжать вместе с версией API.
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [{ path: HEALTH_ROUTE, method: RequestMethod.GET }],
  })

  app.useGlobalPipes(new ZodValidationPipe())
  app.enableShutdownHooks()

  // ДО НАЧАЛА ПРИЁМА ЗАПРОСОВ. Порт, открытый над базой, которая отстала
  // от кода, — это сервис, отвечающий «ok» на /health и падающий на каждом
  // обращении к журналу. Ровно так и вышло 10 сентября.
  //
  // Ошибка здесь долетает до обработчика внизу файла и роняет процесс. Для
  // Railway это неудачная выкатка: прежняя версия продолжает работать.
  await assertMigrated(async (sql) => app.get(PrismaService).$queryRawUnsafe(sql))

  if (env.nodeEnv !== 'production') {
    const openApiConfig = new DocumentBuilder()
      .setTitle('POSitive Loyalty API')
      .setDescription('Программа лояльности для малого бизнеса Пхукета')
      .setVersion(env.appVersion)
      .addBearerAuth()
      .build()

    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApiConfig))
  }

  await app.listen(env.port, '0.0.0.0')

  new Logger('Bootstrap').log(
    `API слушает 0.0.0.0:${env.port} · окружение ${env.nodeEnv} · версия ${env.appVersion}`,
  )
}

bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
  new Logger('Bootstrap').error(`Запуск API не удался — ${reason}`)
  process.exit(1)
})
