import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { ConnectVenueBotInput } from '@positive/contracts'
import type { VenueBotStatus } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { VenueBotService } from './venue-bot.service'

/**
 * Свой Telegram-бот заведения. docs/02, раздел 5.18.
 *
 * Только владелец: ключ бота — секрет, от имени которого пишут всем гостям.
 */
@ApiTags('admin')
@Controller('admin/bot')
@Roles('OWNER')
export class VenueBotController {
  constructor(private readonly bot: VenueBotService) {}

  @Get()
  @ApiOperation({ summary: 'Состояние бота заведения' })
  @ApiOkResponse({ description: 'Подключение, имя бота, число подписчиков' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async status(): Promise<VenueBotStatus> {
    return this.bot.status()
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Подключить бота',
    description: 'Ключ проверяется у Telegram: нерабочий сохранён не будет.',
  })
  @ApiOkResponse({ description: 'Бот подключён' })
  @ApiBadRequestResponse({ description: 'Ключ не похож на ключ или отвергнут Telegram' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async connect(@Body() body: unknown): Promise<VenueBotStatus> {
    const parsed = ConnectVenueBotInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.bot.connect(parsed.data)
  }

  @Delete()
  @ApiOperation({
    summary: 'Отключить бота',
    description: 'Переписка с гостями сохраняется: вернувший бота владелец не теряет подписчиков.',
  })
  @ApiOkResponse({ description: 'Бот отключён' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async disconnect(): Promise<VenueBotStatus> {
    return this.bot.disconnect()
  }
}
