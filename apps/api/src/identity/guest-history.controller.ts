import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { GuestHistoryQuery } from '@positive/contracts'
import type { GuestHistory } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestHistoryService } from './guest-history.service'
import { GuestGuard } from './guest.guard'

/**
 * История операций гостя. docs/02, раздел 2.11.
 *
 * Своя, по всем заведениям сразу: карта общая — история тоже.
 */
@ApiTags('guest')
@Controller('guest/history')
@Public()
@UseGuards(GuestGuard)
export class GuestHistoryController {
  constructor(private readonly history: GuestHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'История начислений и списаний — свежие сверху',
    description: 'По всем заведениям гостя; tenantId сужает до одного.',
  })
  @ApiOkResponse({ description: 'Страница записей и признак «есть ещё»' })
  @ApiBadRequestResponse({ description: 'Неверные параметры страницы' })
  async list(@Query() query: Record<string, unknown>): Promise<GuestHistory> {
    const parsed = GuestHistoryQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.history.list(parsed.data)
  }
}
