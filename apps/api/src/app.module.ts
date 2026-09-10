import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware'
import { RolesGuard } from './common/tenant/roles.guard'
import { TenantGuard } from './common/tenant/tenant.guard'
import { CoreModule } from './core/core.module'
import { HealthModule } from './health/health.module'
import { IdentityModule } from './identity/identity.module'
import { IntegrationsModule } from './integrations/integrations.module'
import { PartnershipsModule } from './partnerships/partnerships.module'
import { PosModule } from './pos/pos.module'

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
    AuthModule,
    IdentityModule,
    AdminModule,
    PartnershipsModule,
    PosModule,
    IntegrationsModule,
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
    {
      // Порядок важен: RolesGuard идёт ПОСЛЕ TenantGuard, потому что роль
      // берётся из уже проверенного токена. Nest применяет глобальные гварды
      // в порядке объявления.
      provide: APP_GUARD,
      useClass: RolesGuard,
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
