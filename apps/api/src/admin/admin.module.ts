import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { CertificatesController } from './certificates.controller'
import { CertificatesService } from './certificates.service'
import { ChannelReportService } from './channel-report.service'
import { ChannelsController } from './channels.controller'
import { ChannelsService } from './channels.service'
import { DashboardService } from './dashboard.service'
import { ProgramSettingsController } from './program-settings.controller'
import { ProgramSettingsService } from './program-settings.service'
import { SaleKindsController } from './sale-kinds.controller'
import { SaleKindsService } from './sale-kinds.service'
import { GuestGiftsController } from './guest-gifts.controller'
import { GuestGiftsService } from './guest-gifts.service'
import { GuestTierController } from './guest-tier.controller'
import { GuestTierService } from './guest-tier.service'
import { GuestNoteController } from './guest-note.controller'
import { GuestNoteService } from './guest-note.service'
import { GuestPointsController } from './guest-points.controller'
import { GuestPointsService } from './guest-points.service'
import { GuestTagsController } from './guest-tags.controller'
import { GuestTagsService } from './guest-tags.service'
import { TagsController } from './tags.controller'
import { TagsService } from './tags.service'
import { StaffController } from './staff.controller'
import { StuckReceiptsController } from './stuck-receipts.controller'
import { StuckReceiptsService } from './stuck-receipts.service'
import { OffersController } from './offers.controller'
import { OffersService } from './offers.service'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'
import { IdentityModule } from '../identity/identity.module'

import { AutomationRunService } from './automation-run.service'
import { AutomationController } from './automation.controller'
import { AutomationService } from './automation.service'
import { AutomationSweeper } from './automation.sweeper'
import { BroadcastSendService } from './broadcast-send.service'
import { BroadcastSweeper } from './broadcast.sweeper'
import { BroadcastsController } from './broadcasts.controller'
import { BroadcastsService } from './broadcasts.service'
import { TenantProfileController } from './tenant-profile.controller'
import { TenantProfileService } from './tenant-profile.service'
import { GuestAudienceService } from './guest-audience.service'
import { MessagesController } from './messages.controller'
import { MessagesService } from './messages.service'
import { ReviewsController } from './reviews.controller'
import { ReviewsService } from './reviews.service'
import { SecurityController } from './security.controller'
import { SecurityService } from './security.service'
import { NewsController } from './news.controller'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'
import { NewsService } from './news.service'
import { TodayController } from './today.controller'
import { TodayService } from './today.service'
import { StaffService } from './staff.service'

/** API бэк-офиса заведения. Всё внутри закрыто глобальным TenantGuard. */
@Module({
  imports: [CoreModule, IdentityModule],
  controllers: [
    AdminController,
    ProgramSettingsController,
    SaleKindsController,
    StaffController,
    GuestGiftsController,
    GuestTierController,
    GuestPointsController,
    GuestNoteController,
    TagsController,
    GuestTagsController,
    StuckReceiptsController,
    OffersController,
    ChannelsController,
    ReportsController,
    CertificatesController,
    ReviewsController,
    MessagesController,
    AutomationController,
    CatalogController,
    TenantProfileController,
    BroadcastsController,
    TodayController,
    SecurityController,
    NewsController,
  ],
  providers: [
    AdminService,
    DashboardService,
    ProgramSettingsService,
    SaleKindsService,
    StaffService,
    GuestGiftsService,
    GuestTierService,
    GuestPointsService,
    GuestNoteService,
    TagsService,
    GuestTagsService,
    StuckReceiptsService,
    OffersService,
    ChannelsService,
    ChannelReportService,
    ReportsService,
    CertificatesService,
    ReviewsService,
    MessagesService,
    BroadcastsService,
    BroadcastSendService,
    BroadcastSweeper,
    AutomationService,
    AutomationRunService,
    AutomationSweeper,
    CatalogService,
    TenantProfileService,
    GuestAudienceService,
    TodayService,
    SecurityService,
    NewsService,
  ],
})
export class AdminModule {}
