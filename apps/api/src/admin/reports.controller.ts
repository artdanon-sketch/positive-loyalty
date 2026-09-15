import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { ChannelReportQuery } from '@positive/contracts'
import type { ChannelReport } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { ChannelReportService } from './channel-report.service'

/**
 * Отчёты заведения. docs/02, раздел 5.9 · docs/11, У7 и У8.
 *
 * Менеджер и владелец — как дашборд: аналитика точки по матрице прав docs/05,
 * раздел 3. Кассиру отчёты не положены.
 */
@ApiTags('admin')
@Controller('admin/reports')
@Roles('MANAGER', 'OWNER')
export class ReportsController {
  constructor(private readonly channelReport: ChannelReportService) {}

  @Get('channels')
  @ApiOperation({ summary: 'Источники: гости, покупатели и выручка за период' })
  @ApiOkResponse({ description: 'По источнику и отдельно — гости без источника' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async channels(@Query() query: Record<string, unknown>): Promise<ChannelReport> {
    const parsed = ChannelReportQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Период — 7d, 30d или 90d',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.channelReport.report(parsed.data.period)
  }
}
