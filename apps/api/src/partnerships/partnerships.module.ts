import { Module } from '@nestjs/common'

import { PartnershipSweepService } from './partnership-sweep.service'
import { PartnershipSweeper } from './partnership-sweeper'
import { PartnershipTriggerService } from './partnership-trigger.service'
import { PartnershipsController } from './partnerships.controller'
import { PartnershipsService } from './partnerships.service'

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
  controllers: [PartnershipsController],
  providers: [
    PartnershipsService,
    PartnershipTriggerService,
    PartnershipSweepService,
    PartnershipSweeper,
  ],
  exports: [PartnershipTriggerService, PartnershipSweepService],
})
export class PartnershipsModule {}
