import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { GuestAuthController } from './guest-auth.controller'
import { GuestAuthService } from './guest-auth.service'
import { GuestController } from './guest.controller'
import { GuestGuard } from './guest.guard'
import { GuestService } from './guest.service'

/** Identity: гости, OTP, каналы (docs/01, раздел 2 — структура модулей). */
@Module({
  imports: [CoreModule],
  controllers: [GuestAuthController, GuestController],
  providers: [GuestAuthService, GuestService, GuestGuard],
})
export class IdentityModule {}
