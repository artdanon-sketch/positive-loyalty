import { Controller, Get } from '@nestjs/common'
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AdminToday } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { TodayService } from './today.service'

/**
 * «Сегодня» на главной бэк-офиса. docs/02, раздел 5.1.2 · docs/11, У11.
 *
 * Менеджер и владелец — как дашборд: кассиру выручка дня не положена (docs/05, раздел 3).
 */
@ApiTags('admin')
@Controller('admin/today')
@Roles('MANAGER', 'OWNER')
export class TodayController {
  constructor(private readonly todayService: TodayService) {}

  @Get()
  @ApiOperation({ summary: 'Сегодня: выручка, покупки, гости, баллы, отмены и шаги настройки' })
  @ApiOkResponse({ description: 'Сутки по часам заведения; все четыре шага настройки по порядку' })
  @ApiForbiddenResponse({ description: 'Кассиру не показывается' })
  async today(): Promise<AdminToday> {
    return this.todayService.today()
  }
}
