import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { RefreshInput, StaffPinLoginInput } from '@positive/contracts'
import type { AuthTokens } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { AuthService } from './auth.service'

/**
 * Аутентификация. Оба маршрута публичны по определению: токена ещё нет.
 *
 * `@Public()` здесь не послабление, а единственный корректный вариант —
 * и он виден в диффе одной строкой, что и было целью глобального гварда.
 */
@ApiTags('auth')
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('staff/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вход сотрудника по PIN',
    description:
      'Заведение определяется по зарегистрированному устройству, а не по телу запроса. ' +
      'Любой отказ отдаёт одинаковый 401 без подробностей.',
  })
  @ApiUnauthorizedResponse({ description: 'Устройство, сотрудник или PIN не подошли' })
  async staffPin(@Body() body: unknown): Promise<AuthTokens> {
    const parsed = StaffPinLoginInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          // Только имена полей: значения содержат PIN.
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.authService.staffPinLogin(parsed.data.deviceId, parsed.data.pin)
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновление сессии',
    description:
      'Refresh ротируется: старый инвалидируется. Повторное использование отозванного ' +
      'гасит всю цепочку сессий — это признак кражи, а не ошибки клиента.',
  })
  @ApiUnauthorizedResponse({ description: 'Refresh недействителен, просрочен или уже использован' })
  async refresh(@Body() body: unknown): Promise<AuthTokens> {
    const parsed = RefreshInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' },
      })
    }

    return this.authService.refresh(parsed.data.refreshToken)
  }
}
