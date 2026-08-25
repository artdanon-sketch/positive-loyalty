import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { CoreModule } from './core/core.module'
import { HealthModule } from './health/health.module'

/**
 * Корневой модуль. Сейчас в нём конфигурация, health-check и ядро (Prisma + ledger):
 * остальные домены (rules, identity, risk, comms, integrations, admin, pos, platform)
 * приезжают следующими задачами дорожной карты.
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
  ],
})
export class AppModule {}
