import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { SetGuestTagsInput } from '@positive/contracts'
import type { GuestTagsResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { GuestTagsService } from './guest-tags.service'

/**
 * Теги на госте. docs/02, раздел 5.2.5.
 *
 * Менеджер и владелец: пометить гостя нужно у стойки. Кассиру — нет.
 */
@ApiTags('admin')
@Controller('admin/guests/:guestId/tags')
@Roles('MANAGER', 'OWNER')
export class GuestTagsController {
  constructor(private readonly guestTags: GuestTagsService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Поставить гостю теги — набором целиком' })
  @ApiOkResponse({ description: 'Теги гостя после сохранения, по названию' })
  @ApiBadRequestResponse({
    description: 'UNKNOWN_TAG — тега нет в заведении; тег дважды; больше 20',
  })
  @ApiForbiddenResponse({ description: 'Кассиру бэк-офис не положен' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  async set(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() body: unknown,
  ): Promise<GuestTagsResult> {
    const parsed = SetGuestTagsInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.guestTags.set(guestId, parsed.data)
  }
}
