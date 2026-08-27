import { Module } from '@nestjs/common'

import { PosWebhookController } from './pos-webhook.controller'
import { PosWebhookService } from './pos-webhook.service'

/**
 * Интеграции с внешними системами. Пока одна — POSitive POS.
 *
 * `CoreModule` не импортируется: он `@Global`, и `PrismaService`
 * с `LedgerService` приезжают оттуда сами.
 */
@Module({
  controllers: [PosWebhookController],
  providers: [PosWebhookService],
  exports: [PosWebhookService],
})
export class IntegrationsModule {}
