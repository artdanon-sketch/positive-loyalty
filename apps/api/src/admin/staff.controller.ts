import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateStaffInput, ResetStaffPinInput, UpdateStaffInput } from '@positive/contracts'
import type { CreateStaffResult, StaffMember } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { StaffService } from './staff.service'

/**
 * Команда заведения. docs/02, раздел 5.5 · docs/05, раздел 3.
 *
 * Только владелец: «Управлять сотрудниками» в матрице прав — одна галочка,
 * и она у него. Менеджер, способный выдать себе или приятелю доступ к кассе,
 * обходил бы весь антифрод кассиров одним действием.
 *
 * Тело разбирается схемой явно: тип параметра стирается при сборке и сам
 * по себе не проверяет ничего.
 */
@ApiTags('admin')
@Controller('admin/staff')
@Roles('OWNER')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'Команда заведения' })
  @ApiOkResponse({ description: 'Сотрудники с устройствами; PIN не отдаётся никогда' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  async list(): Promise<StaffMember[]> {
    return this.staff.list()
  }

  @Post()
  @ApiOperation({
    summary: 'Добавить сотрудника',
    description: 'Заводит сотрудника и его первое устройство. Код устройства возвращается сразу.',
  })
  @ApiOkResponse({ description: 'Сотрудник и код устройства для входа' })
  @ApiBadRequestResponse({ description: 'Неверное имя, роль или слишком простой PIN' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  async create(@Body() body: unknown): Promise<CreateStaffResult> {
    const parsed = CreateStaffInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.staff.create(parsed.data)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить сотрудника',
    description: 'Имя, роль, доступ. Отключение отрезает доступ сразу, а не по истечении токена.',
  })
  @ApiOkResponse({ description: 'Сотрудник изменён' })
  @ApiBadRequestResponse({ description: 'Нечего менять или неверные поля' })
  @ApiForbiddenResponse({ description: 'Не владелец, либо попытка изменить владельца' })
  @ApiNotFoundResponse({ description: 'Сотрудника нет в этом заведении' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StaffMember> {
    const parsed = UpdateStaffInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.staff.update(id, parsed.data)
  }

  @Post(':id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Задать новый PIN',
    description: 'Снимает блокировку после неудачных попыток и отзывает все сессии сотрудника.',
  })
  @ApiOkResponse({ description: 'PIN изменён' })
  @ApiBadRequestResponse({ description: 'PIN не подходит' })
  @ApiForbiddenResponse({ description: 'Не владелец, либо попытка изменить владельца' })
  @ApiNotFoundResponse({ description: 'Сотрудника нет в этом заведении' })
  async resetPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StaffMember> {
    const parsed = ResetStaffPinInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.staff.resetPin(id, parsed.data)
  }
}

/**
 * Отказ валидации. Сообщение первой проблемы идёт наружу как есть: схема пишет
 * их для человека («Слишком простой PIN»), и владельцу полезнее прочитать
 * причину, чем код поля.
 */
const invalid = (
  issues: readonly { path: PropertyKey[]; message: string }[],
): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })
