import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AdjustPointsInput, IdempotencyKeyHeader } from '@positive/contracts'
import type { AdjustPointsResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { GuestPointsService } from './guest-points.service'

/**
 * Баллы вручную. docs/02, раздел 5.2.3.
 *
 * Только владелец: ручная правка баланса — деньги заведения без чека (docs/05).
 */
@ApiTags('admin')
@Controller('admin/guests/:guestId/points')
@Roles('OWNER')
export class GuestPointsController {
  constructor(private readonly points: GuestPointsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Начислить или списать баллы вручную — с причиной' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Один ключ на одно нажатие' })
  @ApiCreatedResponse({ description: 'Правка в журнале; повтор с тем же ключом возвращает ту же' })
  @ApiBadRequestResponse({
    description: 'Нет ключа повтора или причины; сумма ноль или вне границ',
  })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  @ApiConflictResponse({
    description: 'INSUFFICIENT_BALANCE — списать больше, чем есть; IDEMPOTENCY_KEY_REUSED',
  })
  async adjust(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<AdjustPointsResult> {
    const key = IdempotencyKeyHeader.safeParse(idempotencyKey)

    if (!key.success) {
      throw new BadRequestException({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message:
            'Нужен заголовок Idempotency-Key: без него повтор нажатия поправил бы баланс дважды',
        },
      })
    }

    const parsed = AdjustPointsInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.points.adjust(guestId, parsed.data, key.data)
  }
}
