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
import { GuestNoteInput } from '@positive/contracts'
import type { GuestNoteResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { GuestNoteService } from './guest-note.service'

/**
 * Заметка о госте. docs/02, раздел 5.2.4.
 *
 * Менеджер и владелец: заметка нужна у стойки, где владельца обычно нет.
 * Кассиру — нет: бэк-офис ему закрыт целиком (docs/05, раздел 3).
 */
@ApiTags('admin')
@Controller('admin/guests/:guestId/note')
@Roles('MANAGER', 'OWNER')
export class GuestNoteController {
  constructor(private readonly notes: GuestNoteService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Записать или стереть заметку о госте' })
  @ApiOkResponse({ description: 'Заметка после правки; пустой текст — стёрта' })
  @ApiBadRequestResponse({ description: 'Длиннее 1000 знаков' })
  @ApiForbiddenResponse({ description: 'Кассиру бэк-офис не положен' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  async set(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() body: unknown,
  ): Promise<GuestNoteResult> {
    const parsed = GuestNoteInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.notes.set(guestId, parsed.data.text)
  }
}
