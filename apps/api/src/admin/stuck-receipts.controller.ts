import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { StuckReceiptList } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { StuckReceiptsService } from './stuck-receipts.service'

/**
 * Чеки, которые не дошли с планшетов. docs/02, раздел 3.6 · docs/10, раздел 5.7.
 *
 * Владелец и менеджер: гость без баллов — вопрос того, кто отвечает за зал.
 * Кассиру список не нужен: свою очередь он видит на планшете.
 */
@ApiTags('admin')
@Controller('admin/stuck-receipts')
@Roles('MANAGER', 'OWNER')
export class StuckReceiptsController {
  constructor(private readonly stuck: StuckReceiptsService) {}

  @Get()
  @ApiOperation({ summary: 'Чеки, которые не дошли с планшетов' })
  @ApiOkResponse({ description: 'Застрявшие и опаздывающие больше часа; гости по ним без баллов' })
  async list(): Promise<StuckReceiptList> {
    return this.stuck.list()
  }
}
