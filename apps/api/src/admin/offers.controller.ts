import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AdminOffersQuery, CreateOfferInput, SimulateOfferInput } from '@positive/contracts'
import type { AdminOfferList, OfferChangeResult, OfferSimulation } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { OffersService } from './offers.service'

/**
 * Акции заведения. docs/02, раздел 5.3.
 *
 * Смотреть — владелец и менеджер: «аналитика точки» в матрице прав docs/05.
 * Собирать, запускать, ставить на паузу, завершать и прогнозировать — только
 * владелец: «создавать и менять акции» — его галочка.
 */

const validationFailed = (
  issues: ReadonlyArray<{ readonly message: string; readonly path: readonly PropertyKey[] }>,
): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })

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

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  @ApiOperation({ summary: 'Собрать акцию в конструкторе' })
  @ApiCreatedResponse({ description: 'Акция создана: сразу идёт или лежит черновиком' })
  @ApiBadRequestResponse({ description: 'Награда не подходит к типу, конец раньше начала' })
  @ApiForbiddenResponse({ description: 'Собирать акции может только владелец' })
  @ApiConflictResponse({ description: 'OFFER_EXPIRED — запуск акции, чей срок уже прошёл' })
  async create(@Body() body: unknown): Promise<OfferChangeResult> {
    const parsed = CreateOfferInput.safeParse(body)

    if (!parsed.success) {
      throw validationFailed(parsed.error.issues)
    }

    return this.offers.create(parsed.data)
  }

  @Post('simulate')
  @Roles('OWNER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Прогноз акции на истории заведения за 30 дней' })
  @ApiOkResponse({ description: 'Цифры — или причина, почему их нет' })
  @ApiBadRequestResponse({ description: 'Правила не прошли проверку' })
  @ApiForbiddenResponse({ description: 'Прогноз — часть конструктора, он у владельца' })
  async simulate(@Body() body: unknown): Promise<OfferSimulation> {
    const parsed = SimulateOfferInput.safeParse(body)

    if (!parsed.success) {
      throw validationFailed(parsed.error.issues)
    }

    return this.offers.simulate(parsed.data)
  }

  @Post(':id/publish')
  @Roles('OWNER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Запустить черновик или акцию с паузы' })
  @ApiOkResponse({ description: 'Статус после шага; повтор отвечает тем же' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  @ApiNotFoundResponse({ description: 'Акции нет в этом заведении' })
  @ApiConflictResponse({
    description: 'PARTNER_OFFER, OFFER_NOT_SUPPORTED, OFFER_EXPIRED, INVALID_TRANSITION',
  })
  async publish(@Param('id', ParseUUIDPipe) id: string): Promise<OfferChangeResult> {
    return this.offers.transition(id, 'publish')
  }

  @Post(':id/pause')
  @Roles('OWNER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Поставить акцию на паузу' })
  @ApiOkResponse({ description: 'Статус после шага; повтор отвечает тем же' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  @ApiNotFoundResponse({ description: 'Акции нет в этом заведении' })
  @ApiConflictResponse({ description: 'PARTNER_OFFER, INVALID_TRANSITION' })
  async pause(@Param('id', ParseUUIDPipe) id: string): Promise<OfferChangeResult> {
    return this.offers.transition(id, 'pause')
  }

  @Post(':id/end')
  @Roles('OWNER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Завершить акцию' })
  @ApiOkResponse({ description: 'Статус после шага; повтор отвечает тем же' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  @ApiNotFoundResponse({ description: 'Акции нет в этом заведении' })
  @ApiConflictResponse({ description: 'PARTNER_OFFER' })
  async end(@Param('id', ParseUUIDPipe) id: string): Promise<OfferChangeResult> {
    return this.offers.transition(id, 'end')
  }
}
