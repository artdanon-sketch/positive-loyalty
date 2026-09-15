import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateChannelInput, UpdateChannelInput } from '@positive/contracts'
import type { Channel } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { ChannelsService } from './channels.service'

/**
 * Справочник источников трафика. docs/02, раздел 5.9.
 *
 * Смотрит менеджер и владелец: менеджер печатает табличку со ссылкой. Заводит,
 * переименовывает и выключает владелец — источники решают, куда он тратит деньги
 * на продвижение.
 */

const invalid = (
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
@Controller('admin/channels')
@Roles('MANAGER', 'OWNER')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'Источники трафика заведения' })
  @ApiOkResponse({ description: 'Включённые сверху, в порядке заведения' })
  async list(): Promise<Channel[]> {
    return this.channels.list()
  }

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  @ApiOperation({ summary: 'Завести источник — код ссылки выдаёт сервер' })
  @ApiCreatedResponse({ description: 'Источник создан' })
  @ApiBadRequestResponse({ description: 'Название пустое или длинное, источников больше 100' })
  @ApiForbiddenResponse({ description: 'Заводит только владелец' })
  @ApiConflictResponse({ description: 'CHANNEL_EXISTS — такое название уже есть' })
  async create(@Body() body: unknown): Promise<Channel> {
    const parsed = CreateChannelInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.channels.create(parsed.data)
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Переименовать, выключить или снова включить источник' })
  @ApiOkResponse({ description: 'Источник изменён' })
  @ApiBadRequestResponse({ description: 'Нечего менять или значение не проходит' })
  @ApiForbiddenResponse({ description: 'Меняет только владелец' })
  @ApiNotFoundResponse({ description: 'Источника нет в этом заведении' })
  @ApiConflictResponse({ description: 'CHANNEL_EXISTS — такое название уже есть' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Channel> {
    const parsed = UpdateChannelInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.channels.update(id, parsed.data)
  }
}
