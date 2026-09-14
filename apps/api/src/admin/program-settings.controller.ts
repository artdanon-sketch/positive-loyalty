import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { ProgramSettings } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { ProgramSettingsService } from './program-settings.service'

/**
 * Настройки программы. docs/02, раздел 5.6.
 *
 * Только владелец: процент начисления — это деньги заведения, и менеджер,
 * способный поднять его себе в смену, раздавал бы чужую выручку баллами.
 */
@ApiTags('admin')
@Controller('admin/settings/program')
@Roles('OWNER')
export class ProgramSettingsController {
  constructor(private readonly settings: ProgramSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Настройки программы',
    description: 'Только те, что касса уже соблюдает: начисление, оплата баллами, правила кассы.',
  })
  @ApiOkResponse({ description: 'Текущие настройки' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async get(): Promise<ProgramSettings> {
    return this.settings.get()
  }

  @Put()
  @ApiOperation({
    summary: 'Изменить настройки программы',
    description:
      'Заменяет три настройки целиком; остальное в настройках заведения не трогает. ' +
      'Касса применяет новые значения со следующего чека.',
  })
  @ApiOkResponse({ description: 'Настройки сохранены' })
  @ApiBadRequestResponse({ description: 'Значение вне допустимого диапазона' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async update(@Body() body: unknown): Promise<ProgramSettings> {
    const parsed = ProgramSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные настройки',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.update(parsed.data)
  }
}
