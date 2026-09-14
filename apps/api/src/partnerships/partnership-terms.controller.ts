import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { PartnershipReasonInput, ProposeTermInput } from '@positive/contracts'
import type { PartnerSaleKinds, PartnershipDetail } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { PartnershipTermsService } from './partnership-terms.service'

/**
 * Условия партнёрства. docs/07, раздел 9 · docs/02, раздел 5.8.
 *
 * Все действия — только владелец: принятое условие рождает акцию заведения.
 * Каждое действие отвечает карточкой партнёрства целиком — экран
 * перерисовывает её одним ответом, без второго запроса.
 */

type Issues = ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>

const invalid = (issues: Issues): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })

@ApiTags('partnerships')
@Controller('admin/partnerships/:id')
@Roles('OWNER')
export class PartnershipTermsController {
  constructor(private readonly terms: PartnershipTermsService) {}

  @Get('sale-kinds')
  @Roles('MANAGER', 'OWNER')
  @ApiOperation({ summary: 'Виды продаж обеих сторон — для условия «за абонемент»' })
  @ApiOkResponse({ description: 'Наши и их включённые виды продаж' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Приглашение ещё не принято или партнёрство завершено' })
  async saleKinds(@Param('id', ParseUUIDPipe) id: string): Promise<PartnerSaleKinds> {
    return this.terms.saleKinds(id)
  }

  @Post('terms')
  @HttpCode(201)
  @ApiOperation({ summary: 'Предложить условие' })
  @ApiCreatedResponse({ description: 'Условие предложено второй стороне' })
  @ApiBadRequestResponse({
    description: 'Триггер или подарок без механики, чужой или выключенный вид продаж',
  })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Приглашение ещё не принято или партнёрство завершено' })
  async propose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PartnershipDetail> {
    const parsed = ProposeTermInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.terms.propose(id, parsed.data)
  }

  @Post('terms/:termId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Принять условие — у дающего подарок появляется акция' })
  @ApiOkResponse({ description: 'Условие действует' })
  @ApiForbiddenResponse({ description: 'Своё условие принимает другая сторона' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства или условия' })
  @ApiConflictResponse({ description: 'Условие уже не ждёт ответа' })
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('termId', ParseUUIDPipe) termId: string,
  ): Promise<PartnershipDetail> {
    return this.terms.accept(id, termId)
  }

  @Post('terms/:termId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отклонить чужое условие или отозвать своё' })
  @ApiOkResponse({ description: 'Условие закрыто' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства или условия' })
  @ApiConflictResponse({ description: 'Условие уже не ждёт ответа' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() body: unknown,
  ): Promise<PartnershipDetail> {
    const parsed = PartnershipReasonInput.safeParse(body ?? {})

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.terms.reject(id, termId, parsed.data.reason)
  }

  @Post('terms/:termId/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Приостановить действующее условие' })
  @ApiOkResponse({ description: 'Новые подарки не выдаются, выданные действуют' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства или условия' })
  @ApiConflictResponse({ description: 'Условие не действует' })
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('termId', ParseUUIDPipe) termId: string,
  ): Promise<PartnershipDetail> {
    return this.terms.pause(id, termId)
  }

  @Post('terms/:termId/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Снять паузу' })
  @ApiOkResponse({ description: 'Условие снова действует' })
  @ApiForbiddenResponse({ description: 'Паузу поставила другая сторона' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства или условия' })
  @ApiConflictResponse({ description: 'Условие не стоит на паузе' })
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('termId', ParseUUIDPipe) termId: string,
  ): Promise<PartnershipDetail> {
    return this.terms.resume(id, termId)
  }
}
