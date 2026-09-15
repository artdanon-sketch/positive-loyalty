import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { JoinVenueInput } from '@positive/contracts'
import type { JoinVenueResult } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestJoinService } from './guest-join.service'
import { GuestGuard } from './guest.guard'

/**
 * Вступить в заведение по ссылке источника. docs/02, раздел 2.6 · docs/11, У7.
 *
 * Заведение — в адресе, как у приглашения друга: у гостя нет своего заведения.
 */
@ApiTags('guest')
@Controller('guest/venues/:tenantId/join')
@Public()
@UseGuards(GuestGuard)
export class GuestJoinController {
  constructor(private readonly joins: GuestJoinService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Стать гостем заведения по ссылке источника' })
  @ApiOkResponse({ description: 'joined: false — гость уже был гостем заведения' })
  @ApiBadRequestResponse({ description: 'Код не из восьми букв и цифр' })
  @ApiNotFoundResponse({
    description: 'CHANNEL_NOT_FOUND — кода нет в этом заведении или источник выключен',
  })
  async join(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: unknown,
  ): Promise<JoinVenueResult> {
    const parsed = JoinVenueInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.joins.join(tenantId, parsed.data.channel)
  }
}
