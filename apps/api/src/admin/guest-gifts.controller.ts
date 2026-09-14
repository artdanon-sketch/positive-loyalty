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
import { IdempotencyKeyHeader, IssueGiftInput } from '@positive/contracts'
import type { IssueGiftResult } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { GuestGiftsService } from './guest-gifts.service'

/**
 * Подарок гостю из карточки. docs/02, раздел 5.2.1.
 *
 * Менеджер и владелец: подарок нужен у стойки, где владельца обычно нет.
 * Кассиру — нет: бэк-офис ему закрыт целиком (docs/05, раздел 3).
 */
@ApiTags('admin')
@Controller('admin/guests/:guestId/gifts')
@Roles('MANAGER', 'OWNER')
export class GuestGiftsController {
  constructor(private readonly gifts: GuestGiftsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Подарить гостю промокод с причиной' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Один ключ на одно нажатие' })
  @ApiCreatedResponse({ description: 'Подарок у гостя в приложении; повтор возвращает тот же' })
  @ApiBadRequestResponse({ description: 'Нет ключа повтора, нет причины или названия' })
  @ApiForbiddenResponse({ description: 'Кассиру дарить нельзя' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  @ApiConflictResponse({ description: 'Лимит менеджера за сутки или ключ уже использован' })
  async issue(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<IssueGiftResult> {
    const key = IdempotencyKeyHeader.safeParse(idempotencyKey)

    if (!key.success) {
      throw new BadRequestException({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Нужен заголовок Idempotency-Key: без него повтор нажатия подарил бы дважды',
        },
      })
    }

    const parsed = IssueGiftInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.gifts.issue(guestId, parsed.data, key.data)
  }
}
