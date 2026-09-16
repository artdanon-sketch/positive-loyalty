import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { GuestAuthController } from './guest-auth.controller'
import { GuestAuthService } from './guest-auth.service'
import { GuestJoinController } from './guest-join.controller'
import { GuestJoinService } from './guest-join.service'
import { GuestReferralController } from './guest-referral.controller'
import { GuestReferralService } from './guest-referral.service'
import { GuestReviewsController } from './guest-reviews.controller'
import { GuestReviewsService } from './guest-reviews.service'
import { GuestNewsController } from './guest-news.controller'
import { GuestNewsService } from './guest-news.service'
import { GuestController } from './guest.controller'
import { GuestSocialController } from './guest-social.controller'
import { GuestGuard } from './guest.guard'
import { GuestService } from './guest.service'
import { TelegramBotService } from './telegram-bot.service'
import { TelegramLoginService } from './telegram-login.service'
import { TelegramUpdatesService } from './telegram-updates.service'

/** Identity: гости, OTP, каналы (docs/01, раздел 2 — структура модулей). */
@Module({
  imports: [CoreModule],
  controllers: [
    GuestAuthController,
    GuestSocialController,
    GuestController,
    GuestReferralController,
    GuestJoinController,
    GuestReviewsController,
    GuestNewsController,
  ],
  providers: [
    GuestAuthService,
    GuestService,
    GuestReferralService,
    GuestJoinService,
    GuestReviewsService,
    GuestNewsService,
    GuestGuard,
    TelegramBotService,
    TelegramLoginService,
    TelegramUpdatesService,
  ],
})
export class IdentityModule {}
