import 'reflect-metadata'

import { Logger, RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { ZodValidationPipe } from 'nestjs-zod'

import { AppModule } from './app.module'
import { getEnv } from './common/config/env'

const HEALTH_ROUTE = 'health'
const GLOBAL_PREFIX = 'v1'

const bootstrap = async (): Promise<void> => {
  // `rawBody` — ради подписи вебхуков от кассы. Она считается по СЫРЫМ БАЙТАМ
  // тела: разобранный и снова собранный JSON даёт другой порядок ключей
  // и другие пробелы, и хеш не сходится (docs/02, раздел 4.1).
  const app = await NestFactory.create(AppModule, { rawBody: true })

  // ConfigModule уже подтянул .env в process.env, поэтому разбор окружения — здесь.
  // Некорректная конфигурация роняет процесс до того, как порт начнёт слушаться.
  const env = getEnv()

  app.use(helmet())

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
