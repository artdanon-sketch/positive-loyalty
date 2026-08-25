import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { AdminModule } from './admin/admin.module'
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware'
import { TenantGuard } from './common/tenant/tenant.guard'
import { CoreModule } from './core/core.module'
import { HealthModule } from './health/health.module'

/**
 * Корневой модуль. Сейчас в нём конфигурация, health-check, ядро (Prisma + ledger)
 * и API бэк-офиса: остальные домены (rules, identity, risk, comms, integrations,
 * pos, platform) приезжают следующими задачами дорожной карты.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Локально .env лежит либо рядом с приложением, либо в корне монорепо.
      // В облаке файлов нет — переменные приходят из окружения Railway.
      envFilePath: ['.env', '../../.env'],
    }),
    // Строго после ConfigModule: PrismaService читает DATABASE_URL при создании,
    // а в process.env её кладёт именно ConfigModule.
    CoreModule,
    HealthModule,
    AdminModule,
  ],
  providers: [
    {
      /**
       * Гвард тенанта — ГЛОБАЛЬНЫЙ, и это принципиально.
       *
       * Умолчание «закрыто», исключения помечаются `@Public()` поштучно. Обратный
       * подход — вешать гвард на каждый контроллер — держится на том, что никто
       * не забудет, а забывают всегда: новый контроллер без гварда выглядит
       * работающим и молча отдаёт данные без токена.
       */
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Контекст открывается на ВСЕХ маршрутах, включая публичные: сквозной
    // requestId нужен в логах и на /health тоже. Решение о доступе принимает гвард.
    consumer.apply(TenantContextMiddleware).forRoutes('*')
  }
}
