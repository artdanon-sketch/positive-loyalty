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
import { StaffService } from './staff.service'

/** API бэк-офиса заведения. Всё внутри закрыто глобальным TenantGuard. */
@Module({
  imports: [CoreModule],
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
  ],
})
export class AdminModule {}
