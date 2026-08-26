import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { GuestRefreshInput, OtpRequestInput, OtpVerifyInput } from '@positive/contracts'
import type { GuestAuthResult, OtpRequestResult } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestAuthService } from './guest-auth.service'

/** Вход гостя. Публичный по определению: токена ещё нет. */
@ApiTags('auth')
@Controller('auth/otp')
@Public()
export class GuestAuthController {
  constructor(private readonly guestAuthService: GuestAuthService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Запросить код подтверждения' })
  async request(@Body() body: unknown): Promise<OtpRequestResult> {
    const parsed = OtpRequestInput.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          // Только пути полей: в значениях телефон.
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }
    return this.guestAuthService.requestOtp(parsed.data.phone, parsed.data.channel)
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтвердить код и войти' })
  async verify(@Body() body: unknown): Promise<GuestAuthResult> {
    const parsed = OtpVerifyInput.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' },
      })
    }
    return this.guestAuthService.verifyOtp(parsed.data.requestId, parsed.data.code)
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Обновить гостевую сессию' })
  async refresh(@Body() body: unknown): Promise<GuestAuthResult> {
    const parsed = GuestRefreshInput.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' },
      })
    }
    return this.guestAuthService.refresh(parsed.data.refreshToken)
  }
}
