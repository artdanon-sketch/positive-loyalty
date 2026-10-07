import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { PosAppService } from './pos-app.service'
import { PosQueueController } from './pos-queue.controller'
import { PosQueueService } from './pos-queue.service'
import { PosController } from './pos.controller'
import { PosService } from './pos.service'

@Module({
  imports: [CoreModule],
  controllers: [PosController, PosQueueController],
  providers: [PosService, PosQueueService, PosAppService],
})
export class PosModule {}
