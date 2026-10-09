import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { ChannelReportQuery, ReportQuery } from '@positive/contracts'
import type {
  ChannelReport,
  CustomersReport,
  DashboardPeriod,
  OperationsReport,
  RfmReport,
  StaffReport,
  TopGuestsReport,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { ChannelReportService } from './channel-report.service'
import { ReportsService } from './reports.service'

/**
 * Отчёты заведения. docs/02, разделы 5.9 и 5.10 · docs/11, У7 и У8.
 *
 * Менеджер и владелец — как дашборд: аналитика точки по матрице прав docs/05,
 * раздел 3. Кассиру отчёты не положены.
 */

const periodOf = (query: Record<string, unknown>): DashboardPeriod => {
  const parsed = ReportQuery.safeParse(query)

  if (!parsed.success) {
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Период — 7d, 30d или 90d',
        details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
      },
    })
  }

  return parsed.data.period
}

@ApiTags('admin')
@Controller('admin/reports')
@Roles('MANAGER', 'OWNER')
export class ReportsController {
  constructor(
    private readonly channelReport: ChannelReportService,
    private readonly reports: ReportsService,
  ) {}

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

  @Get('customers')
  @ApiOperation({ summary: 'Клиенты: всего, доля покупателей, новые по дням, туристы и резиденты' })
  @ApiOkResponse({ description: 'Итоги и каждый день периода' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async customers(@Query() query: Record<string, unknown>): Promise<CustomersReport> {
    return this.reports.customers(periodOf(query))
  }

  @Get('operations')
  @ApiOperation({ summary: 'Операции: выручка, покупки, средний чек, баллы, отмены по дням' })
  @ApiOkResponse({ description: 'Итоги и каждый день периода, отменённые чеки не в счёт' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async operations(@Query() query: Record<string, unknown>): Promise<OperationsReport> {
    return this.reports.operations(periodOf(query))
  }

  @Get('rfm')
  @ApiOperation({ summary: 'RFM: десять сегментов покупателей на сегодня' })
  @ApiOkResponse({ description: 'Все десять сегментов, пустые — нулями' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async rfm(): Promise<RfmReport> {
    return this.reports.rfm()
  }

  @Get('staff')
  @ApiOperation({ summary: 'Сотрудники: чеки, выручка и новые гости за период' })
  @ApiOkResponse({ description: 'По сотруднику и отдельно — чеки из кассы POSitive' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async staff(@Query() query: Record<string, unknown>): Promise<StaffReport> {
    return this.reports.staff(periodOf(query))
  }

  @Get('top-guests')
  @ApiOperation({ summary: 'Лучшие гости: двадцать по выручке за период' })
  @ApiOkResponse({ description: 'Место, гость, покупки и выручка за период, баланс сейчас' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Кассиру отчёты не положены' })
  async topGuests(@Query() query: Record<string, unknown>): Promise<TopGuestsReport> {
    return this.reports.topGuests(periodOf(query))
  }
}
