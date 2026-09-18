import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { VenueBotInvite } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestGuard } from './guest.guard'
import { VenueBotLinkService } from './venue-bot-link.service'

/**
 * Подключение гостя к боту заведения. docs/02, раздел 2.14.
 *
 * Telegram не даёт боту писать первым: пока гость не нажал «Запустить»
 * у бота кафе, сообщения ему идут через общего бота.
 */
@ApiTags('guest')
@Controller('guest/venues/:tenantId/bot')
@Public()
@UseGuards(GuestGuard)
export class VenueBotLinkController {
  constructor(private readonly links: VenueBotLinkService) {}

  @Post('invite')
  @ApiOperation({
    summary: 'Ссылка на бота заведения',
    description: 'Одноразовый код внутри живёт час: он подключает чат именно к этой карте.',
  })
  @ApiOkResponse({ description: 'Ссылка вида t.me/<бот>?start=<код>' })
  @ApiNotFoundResponse({ description: 'У заведения нет своего бота' })
  async invite(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<VenueBotInvite> {
    return this.links.invite(tenantId)
  }
}
