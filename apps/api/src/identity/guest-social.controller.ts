import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SocialLoginInput, TelegramClaimInput } from '@positive/contracts'
import type {
  GuestAuthResult,
  TelegramClaimResult,
  TelegramLoginStartResult,
} from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestAuthService } from './guest-auth.service'
import { TelegramLoginService } from './telegram-login.service'

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
  constructor(
    private readonly guestAuthService: GuestAuthService,
    private readonly telegramLogin: TelegramLoginService,
  ) {}

  /**
   * Наружу — только имена полей. В значении лежит токен, а в токене почта
   * и имя человека: подробностям разбора там не место.
   */
  private invalid(fields: string[]): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Некорректный запрос',
        details: { fields },
      },
    })
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Войти через аккаунт Google' })
  @ApiResponse({ status: 200, description: 'Вход выполнен, выданы токены гостя' })
  @ApiResponse({ status: 400, description: 'Тело запроса не соответствует контракту' })
  @ApiResponse({ status: 401, description: 'Токен Google не принят' })
  async google(@Body() body: unknown): Promise<GuestAuthResult> {
    const parsed = SocialLoginInput.safeParse(body)

    if (!parsed.success) {
      throw this.invalid(parsed.error.issues.map((issue) => issue.path.join('.')))
    }

    return this.guestAuthService.loginWithGoogle(parsed.data.idToken)
  }

  /**
   * Начать вход через Telegram: сервер выдаёт одноразовую ссылку на бота.
   *
   * Тела у запроса нет — предъявлять пока нечего. Адрес клиента нужен ровно
   * для ограничения частоты: эндпоинт публичный и создаёт строку в базе.
   */
  @Post('telegram/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Начать вход через Telegram' })
  @ApiResponse({ status: 200, description: 'Ссылка на бота выдана' })
  @ApiResponse({ status: 400, description: 'Вход через Telegram не настроен либо слишком часто' })
  async telegramStart(@Ip() ip: string): Promise<TelegramLoginStartResult> {
    return this.telegramLogin.start(ip)
  }

  /**
   * Спросить результат. Отвечает всегда `200`: «ещё нет» — это нормальный ход
   * обмена, а не ошибка, и превращать ожидание в отказ значит заставлять
   * приложение разбирать коды состояния вместо чтения поля.
   */
  @Post('telegram/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Забрать сессию после подтверждения в Telegram' })
  @ApiResponse({ status: 200, description: 'Состояние входа: PENDING, READY или EXPIRED' })
  @ApiResponse({ status: 400, description: 'Тело запроса не соответствует контракту' })
  async telegramClaim(@Body() body: unknown): Promise<TelegramClaimResult> {
    const parsed = TelegramClaimInput.safeParse(body)

    if (!parsed.success) {
      throw this.invalid(parsed.error.issues.map((issue) => issue.path.join('.')))
    }

    return this.telegramLogin.claim(parsed.data.requestId, parsed.data.claimSecret)
  }
}
