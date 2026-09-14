import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { DashboardService } from './dashboard.service'
import { SaleKindsController } from './sale-kinds.controller'
import { SaleKindsService } from './sale-kinds.service'
import { StaffController } from './staff.controller'
import { StaffService } from './staff.service'

/** API бэк-офиса заведения. Всё внутри закрыто глобальным TenantGuard. */
@Module({
  imports: [CoreModule],
  controllers: [AdminController, SaleKindsController, StaffController],
  providers: [AdminService, DashboardService, SaleKindsService, StaffService],
})
export class AdminModule {}
