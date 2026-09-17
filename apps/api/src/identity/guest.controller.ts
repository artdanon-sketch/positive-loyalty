import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { GuestBirthdayInput, UpdateGuestProfileInput } from '@positive/contracts'
import type { GuestMe, GuestQrToken, GuestWallet } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestGuard } from './guest.guard'
import { GuestService } from './guest.service'

/**
 * API гостя. docs/02, разделы 2.1–2.2 и 2.7.
 *
 * @Public снимает тенантный гвард — у гостя нет заведения;
 * GuestGuard ставит своё требование: гостевой токен в запросе.
 */
@ApiTags('guest')
@Controller('guest')
@Public()
@UseGuards(GuestGuard)
export class GuestController {
  constructor(private readonly guestService: GuestService) {}

  @Get('me')
  @ApiOperation({ summary: 'Профиль гостя' })
  async me(): Promise<GuestMe> {
    return this.guestService.me()
  }

  @Put('me')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Изменить имя и язык',
    description:
      'Телефон меняется входом по новому номеру, день рождения ставится один раз, ' +
      '«турист или резидент» — наблюдение системы, а не анкета.',
  })
  @ApiOkResponse({ description: 'Обновлённый профиль' })
  @ApiBadRequestResponse({ description: 'Имя короче двух знаков или неизвестный язык' })
  async updateProfile(@Body() body: unknown): Promise<GuestMe> {
    const parsed = UpdateGuestProfileInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.guestService.updateProfile(parsed.data)
  }

  @Put('me/birthday')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Указать день рождения — один раз',
    description:
      'Заведения дарят подарок ко дню рождения. Дата указывается один раз: иначе подарок ' +
      'можно было бы получать, меняя дату.',
  })
  @ApiOkResponse({ description: 'Профиль с днём рождения' })
  @ApiBadRequestResponse({ description: 'Дата не YYYY-MM-DD, из будущего или раньше 1900 года' })
  @ApiConflictResponse({ description: 'BIRTHDAY_ALREADY_SET — день рождения уже указан' })
  async setBirthday(@Body() body: unknown): Promise<GuestMe> {
    const parsed = GuestBirthdayInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректная дата',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.guestService.setBirthday(parsed.data.date)
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Кошелёк: баллы во всех заведениях' })
  async wallet(): Promise<GuestWallet> {
    return this.guestService.wallet()
  }

  @Get('qr-token')
  @ApiOperation({
    summary: 'Токен для показа на кассе',
    description:
      'Короткоживущий и отдельного вида: перехваченный с экрана код не годится ' +
      'ни для входа, ни для гостевого API.',
  })
  qrToken(): GuestQrToken {
    return this.guestService.qrToken()
  }
}
