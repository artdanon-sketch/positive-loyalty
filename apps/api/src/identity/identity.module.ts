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
import { GuestMessagesController } from './guest-messages.controller'
import { GuestMessagesService } from './guest-messages.service'
import { GuestCatalogController } from './guest-catalog.controller'
import { GuestCatalogService } from './guest-catalog.service'
import { GuestHistoryController } from './guest-history.controller'
import { GuestHistoryService } from './guest-history.service'
import { GuestNewsController } from './guest-news.controller'
import { GuestPushController } from './guest-push.controller'
import { GuestPushService } from './guest-push.service'
import { PushService } from './push.service'
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
    GuestCatalogController,
    GuestHistoryController,
    GuestNewsController,
    GuestPushController,
    GuestMessagesController,
  ],
  providers: [
    GuestAuthService,
    GuestService,
    GuestReferralService,
    GuestJoinService,
    GuestReviewsService,
    GuestCatalogService,
    GuestHistoryService,
    GuestNewsService,
    GuestPushService,
    PushService,
    GuestMessagesService,
    GuestGuard,
    TelegramBotService,
    TelegramLoginService,
    TelegramUpdatesService,
  ],
  // Бот нужен рассылкам (AdminModule): канал доставки один и тот же, и заводить
  // второго клиента Telegram значило бы держать два разных представления о боте.
  exports: [TelegramBotService, PushService],
})
export class IdentityModule {}
