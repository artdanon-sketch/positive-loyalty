import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { RotateSecretInput } from '@positive/contracts'
import type {
  IntegrationConnected,
  IntegrationSecret,
  IntegrationStatus,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { IntegrationService } from './integration.service'

/**
 * Интеграция с кассой. docs/02, раздел 5.16.
 *
 * Только владелец: ключом подписывают чеки, и кто им владеет — начисляет баллы
 * от имени заведения.
 */
@ApiTags('admin')
@Controller('admin/integration')
@Roles('OWNER')
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}

  @Get()
  @ApiOperation({
    summary: 'Состояние связки с кассой',
    description: 'Подключение, адреса, замаскированный ключ и счётчики принятого за неделю.',
  })
  @ApiOkResponse({ description: 'Состояние интеграции' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async status(): Promise<IntegrationStatus> {
    return this.integration.status()
  }

  @Post('connect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Подключить кассу',
    description:
      'Заводит связку и один раз отдаёт идентификатор заведения и ключ: их вписывают ' +
      'в настройки POSitive POS. Вторую связку не заводит.',
  })
  @ApiOkResponse({ description: 'Что вписать в кассу' })
  @ApiConflictResponse({ description: 'Касса уже подключена' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async connect(): Promise<IntegrationConnected> {
    return this.integration.connect()
  }

  @Post('secret/reveal')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Показать ключ подписи',
    description: 'Отдельным действием и с записью в историю: ключ выдаётся человеку.',
  })
  @ApiOkResponse({ description: 'Полный ключ' })
  @ApiNotFoundResponse({ description: 'Касса не подключена' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async reveal(): Promise<IntegrationSecret> {
    return this.integration.revealSecret()
  }

  @Post('secret/rotate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Перевыпустить ключ подписи',
    description:
      'После перевыпуска касса перестаёт присылать чеки, пока в ней не поменяют ключ. ' +
      'Причина обязательна и уходит в историю.',
  })
  @ApiOkResponse({ description: 'Новый ключ' })
  @ApiBadRequestResponse({ description: 'Причина короче восьми знаков' })
  @ApiNotFoundResponse({ description: 'Касса не подключена' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async rotate(@Body() body: unknown): Promise<IntegrationSecret> {
    const parsed = RotateSecretInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.integration.rotateSecret(parsed.data)
  }
}
