import { Module } from '@nestjs/common'

import { AuditService } from '../core/audit.service'

import { PlatformAuthController } from './platform-auth.controller'
import { PlatformTenantsController } from './platform-tenants.controller'
import { PlatformAuthService } from './platform-auth.service'
import { PlatformPrismaService } from './platform-prisma.service'
import { PlatformStatsService } from './platform-stats.service'
import { PlatformGuard } from './platform.guard'

/**
 * Модуль админки платформы.
 *
 * ─── ОН НЕ ПОДКЛЮЧАЕТСЯ В AppModule, И ЭТО ГЛАВНОЕ ──────────────────────────
 *
 * Единственное место, где он появляется, — platform-main.ts: отдельная точка
 * входа, отдельный процесс, отдельный сервис на Railway, отдельная роль
 * Postgres и отдельный секрет подписи токенов.
 *
 * Подключить его в AppModule по недосмотру значило бы повесить вход, видящий
 * все заведения, на тот же порт, который обслуживает владельцев ресторанов.
 * Чтобы это не осталось обещанием в комментарии, есть тест
 * platform-not-in-api: он поднимает основное приложение и требует, чтобы
 * маршрутов /v1/platform в нём не было ни одного.
 *
 * ─── СВОЙ AuditService, А НЕ ГЛОБАЛЬНЫЙ ИЗ CoreModule ───────────────────────
 *
 * Аудит объявлен здесь заново и намеренно: глобальный собран поверх обычного
 * PrismaService, то есть ходит ролью positive_app. Той роли таблицы админки
 * платформы недоступны вовсе, а писать в аудит она может — так что подмены
 * никто бы не заметил, пока не понадобилось бы прочитать журнал.
 *
 * Здесь и запись, и чтение аудита идут ролью платформы: она единственная,
 * у кого есть SELECT на AuditLog.
 */
@Module({
  controllers: [PlatformAuthController, PlatformTenantsController],
  providers: [
    PlatformPrismaService,
    PlatformGuard,
    {
      provide: AuditService,
      useFactory: (prisma: PlatformPrismaService) => new AuditService(prisma),
      inject: [PlatformPrismaService],
    },
    PlatformAuthService,
    PlatformStatsService,
  ],
  exports: [PlatformPrismaService, PlatformAuthService],
})
export class PlatformModule {}
