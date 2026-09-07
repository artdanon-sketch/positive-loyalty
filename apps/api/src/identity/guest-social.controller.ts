import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SocialLoginInput } from '@positive/contracts'
import type { GuestAuthResult } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestAuthService } from './guest-auth.service'

/**
 * Вход гостя через аккаунт. Публичный по определению: токена ещё нет.
 *
 * Отдельный контроллер, а не ещё один метод рядом с кодами подтверждения:
 * пути разные (`auth/social` против `auth/otp`), и способы разные по сути —
 * там мы САМИ подтверждаем личность кодом, здесь принимаем чужое подтверждение
 * и обязаны его проверить.
 */
@ApiTags('auth')
@Controller('auth/social')
@Public()
export class GuestSocialController {
  constructor(private readonly guestAuthService: GuestAuthService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Войти через аккаунт Google' })
  @ApiResponse({ status: 200, description: 'Вход выполнен, выданы токены гостя' })
  @ApiResponse({ status: 400, description: 'Тело запроса не соответствует контракту' })
  @ApiResponse({ status: 401, description: 'Токен Google не принят' })
  async google(@Body() body: unknown): Promise<GuestAuthResult> {
    const parsed = SocialLoginInput.safeParse(body)

    if (!parsed.success) {
      // Наружу — только имена полей. В значении лежит токен, а в токене
      // почта и имя человека: подробностям разбора там не место.
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.guestAuthService.loginWithGoogle(parsed.data.idToken)
  }
}
