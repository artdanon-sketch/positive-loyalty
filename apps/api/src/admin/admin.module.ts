import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { DashboardService } from './dashboard.service'
import { ProgramSettingsController } from './program-settings.controller'
import { ProgramSettingsService } from './program-settings.service'
import { SaleKindsController } from './sale-kinds.controller'
import { SaleKindsService } from './sale-kinds.service'
import { GuestGiftsController } from './guest-gifts.controller'
import { GuestGiftsService } from './guest-gifts.service'
import { GuestTierController } from './guest-tier.controller'
import { GuestTierService } from './guest-tier.service'
import { StaffController } from './staff.controller'
import { StuckReceiptsController } from './stuck-receipts.controller'
import { StuckReceiptsService } from './stuck-receipts.service'
import { OffersController } from './offers.controller'
import { OffersService } from './offers.service'
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
    StuckReceiptsController,
    OffersController,
  ],
  providers: [
    AdminService,
    DashboardService,
    ProgramSettingsService,
    SaleKindsService,
    StaffService,
    GuestGiftsService,
    GuestTierService,
    StuckReceiptsService,
    OffersService,
  ],
})
export class AdminModule {}
