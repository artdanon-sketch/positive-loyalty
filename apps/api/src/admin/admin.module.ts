import { Module } from '@nestjs/common'

import { CoreModule } from '../core/core.module'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { DashboardService } from './dashboard.service'
import { SaleKindsController } from './sale-kinds.controller'
import { SaleKindsService } from './sale-kinds.service'

/** API бэк-офиса заведения. Всё внутри закрыто глобальным TenantGuard. */
@Module({
  imports: [CoreModule],
  controllers: [AdminController, SaleKindsController],
  providers: [AdminService, DashboardService, SaleKindsService],
})
export class AdminModule {}
