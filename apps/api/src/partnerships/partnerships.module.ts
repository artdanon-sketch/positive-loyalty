import { Module } from '@nestjs/common'

import { PartnershipTriggerService } from './partnership-trigger.service'

/**
 * Партнёрства между заведениями (docs/07).
 *
 * Живёт в ОСНОВНОМ приложении, а не в админке платформы, и это принципиально:
 * договариваются заведения между собой, платформа в договорённости не участвует.
 * Её панель партнёрства только показывает.
 *
 * PrismaService и OfferGrantService приходят из CoreModule — он @Global.
 */
@Module({
  providers: [PartnershipTriggerService],
  exports: [PartnershipTriggerService],
})
export class PartnershipsModule {}
