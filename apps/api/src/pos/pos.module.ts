import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { PosController } from './pos.controller'
import { PosService } from './pos.service'

@Module({
  imports: [CoreModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
