import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { HealthModule } from './health/health.module'

/**
 * Корневой модуль. Пока в нём только конфигурация и health-check:
 * домены (core, rules, identity, risk, comms, integrations, admin, pos, platform)
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
    HealthModule,
  ],
})
export class AppModule {}
