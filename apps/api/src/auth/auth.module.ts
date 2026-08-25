import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  imports: [CoreModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
