import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateGuestMessageInput } from '@positive/contracts'
import type { GuestMessageView, GuestMessages } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestMessagesService } from './guest-messages.service'
import { GuestGuard } from './guest.guard'

/**
 * «Написать заведению» — жалобы и предложения. docs/02, раздел 2.10.
 *
 * Заведение — из тела запроса, в отличие от отзыва: обращение не привязано к визиту,
 * и гость сам выбирает, кому пишет. Чужое заведение отобьёт база.
 */
@ApiTags('guest')
@Controller('guest/messages')
@Public()
@UseGuards(GuestGuard)
export class GuestMessagesController {
  constructor(private readonly messages: GuestMessagesService) {}

  @Get()
  @ApiOperation({ summary: 'Свои обращения с ответами заведений — свежие сверху' })
  @ApiOkResponse({ description: 'Последние двадцать' })
  async list(): Promise<GuestMessages> {
    return this.messages.list()
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Написать заведению: жалоба или предложение' })
  @ApiCreatedResponse({ description: 'Обращение; ответ появится в нём позже' })
  @ApiBadRequestResponse({ description: 'Текст пустой или длиннее тысячи, вид не из двух' })
  @ApiNotFoundResponse({ description: 'VENUE_NOT_FOUND — гость в этом заведении не бывал' })
  @ApiConflictResponse({
    description: 'MESSAGE_LIMIT_REACHED — три обращения без ответа этому заведению',
  })
  async create(@Body() body: unknown): Promise<GuestMessageView> {
    const parsed = CreateGuestMessageInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректное обращение',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.messages.create(parsed.data)
  }
}
