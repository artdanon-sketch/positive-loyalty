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
import { StaffController } from './staff.controller'
import { StuckReceiptsController } from './stuck-receipts.controller'
import { StuckReceiptsService } from './stuck-receipts.service'
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
    StuckReceiptsController,
  ],
  providers: [
    AdminService,
    DashboardService,
    ProgramSettingsService,
    SaleKindsService,
    StaffService,
    GuestGiftsService,
    StuckReceiptsService,
  ],
})
export class AdminModule {}
