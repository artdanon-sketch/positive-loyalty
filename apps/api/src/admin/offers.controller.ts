import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminOffersQuery } from '@positive/contracts'
import type { AdminOfferList } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { OffersService } from './offers.service'

/**
 * Акции заведения. docs/02, раздел 5.3.
 *
 * Смотреть — владелец и менеджер: «аналитика точки» в матрице прав docs/05.
 * Создавать и менять акции будет только владелец — вместе с конструктором.
 */
@ApiTags('admin')
@Controller('admin/offers')
@Roles('MANAGER', 'OWNER')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Акции заведения' })
  @ApiOkResponse({ description: 'Идущие первыми; у каждой — выдано, использовано, вернулось' })
  @ApiBadRequestResponse({ description: 'Неизвестный фильтр или язык' })
  async list(@Query() query: Record<string, unknown>): Promise<AdminOfferList> {
    const parsed = AdminOffersQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные параметры запроса',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.offers.list(parsed.data.filter, parsed.data.locale)
  }
}
