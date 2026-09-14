import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Put } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PosQueueReport } from '@positive/contracts'
import type { PosQueueReportResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { PosQueueService } from './pos-queue.service'

/**
 * Снимок очереди отложенных чеков. docs/02, раздел 3.6.
 *
 * Шлёт любой, кто стоит за кассой: застрявший чек не спрашивает, чья смена.
 */
@ApiTags('pos')
@Controller('pos/queue')
@Roles('CASHIER', 'MANAGER', 'OWNER')
export class PosQueueController {
  constructor(private readonly queue: PosQueueService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Снимок очереди отложенных чеков планшета',
    description:
      'Целиком, а не изменения: чего нет в снимке, из очереди ушло. Сервер ничего ' +
      'не проводит — только показывает владельцу, какие гости ещё без баллов.',
  })
  @ApiOkResponse({ description: 'Снимок принят' })
  @ApiBadRequestResponse({ description: 'Нет метки планшета, больше 200 чеков или лишние поля' })
  async report(@Body() body: unknown): Promise<PosQueueReportResult> {
    const parsed = PosQueueReport.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный снимок очереди',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.queue.report(parsed.data)
  }
}
