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
import { SetGuestTierInput } from '@positive/contracts'
import type { GuestTierResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { GuestTierService } from './guest-tier.service'

/**
 * Ручной статус гостя. docs/02, раздел 5.2.2 · docs/11, У3.
 *
 * Только владелец: статус меняет ставки начисления и оплаты баллами, то есть
 * деньги заведения (docs/05). Причина обязательна и уходит в аудит.
 */
@ApiTags('admin')
@Controller('admin/guests/:guestId/tier')
@Roles('OWNER')
export class GuestTierController {
  constructor(private readonly tiers: GuestTierService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Назначить гостю статус вручную или вернуть на лестницу' })
  @ApiOkResponse({ description: 'Статус гостя после правки' })
  @ApiBadRequestResponse({
    description: 'Нет причины; UNKNOWN_TIER — такого статуса нет в настройках программы',
  })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  async set(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() body: unknown,
  ): Promise<GuestTierResult> {
    const parsed = SetGuestTierInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.tiers.set(guestId, parsed.data)
  }
}
