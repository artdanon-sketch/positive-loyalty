import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common'
import { PlatformMeResult, PlatformSignInInput, PlatformSignInResult } from '@positive/contracts'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { PlatformAuthService, PlatformSignInFailedError } from './platform-auth.service'
import { PlatformPrismaService } from './platform-prisma.service'
import { PlatformGuard, type PlatformRequest } from './platform.guard'

import { UnauthorizedException } from '@nestjs/common'

/**
 * Вход в админку платформы: `/v1/platform/auth/*`.
 *
 * ─── ЭТИХ МАРШРУТОВ НЕТ В ОСНОВНОМ API ───────────────────────────────────────
 *
 * Модуль подключается только в platform-main.ts — отдельном процессе, который
 * ходит в базу ролью positive_platform. В AppModule его нет, и это проверяется
 * тестом, а не обещанием: подключить сюда PlatformModule по недосмотру значило бы
 * повесить вход, видящий все заведения, на тот же порт, что обслуживает
 * владельцев ресторанов.
 *
 * ─── КОНТРОЛЛЕР ТОЛЬКО МАРШРУТИЗИРУЕТ ───────────────────────────────────────
 *
 * Вся логика — в PlatformAuthService: он решает, впускать ли, и оставляет след
 * в аудите. Здесь остаётся перевод исключения в код ответа.
 */
@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly prisma: PlatformPrismaService,
  ) {}

  /**
   * Вход одним шагом.
   *
   * `401` на ЛЮБУЮ причину: нет такой почты, неверный пароль, неверный код,
   * повтор кода, чужое устройство, блокировка. Разный ответ на разные причины
   * превратил бы форму входа в справочник — сначала подбирается почта, потом
   * пароль, потом код.
   */
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход админа платформы: пароль, код 2FA, устройство' })
  @ApiResponse({ status: 200, description: 'Впущен: токены выданы' })
  @ApiResponse({ status: 401, description: 'Отказ. Причина намеренно не раскрывается' })
  async signIn(@Body() body: PlatformSignInInput): Promise<PlatformSignInResult> {
    try {
      const result = await this.auth.signIn({
        email: body.email,
        password: body.password,
        totpCode: body.totpCode,
        deviceId: body.deviceId,
        deviceLabel: body.deviceLabel,
        now: new Date(),
      })

      return {
        adminId: result.adminId,
        displayName: result.displayName,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        refreshToken: result.refreshToken,
        deviceEnrolled: result.deviceEnrolled,
      }
    } catch (error) {
      if (error instanceof PlatformSignInFailedError) {
        throw new UnauthorizedException('Вход не выполнен')
      }

      throw error
    }
  }

  /** Кто вошёл. Минимальный защищённый маршрут: им проверяется, что токен работает. */
  @Get('me')
  @UseGuards(PlatformGuard)
  @ApiOperation({ summary: 'Текущий админ платформы' })
  @ApiResponse({ status: 200, description: 'Данные вошедшего' })
  @ApiResponse({ status: 401, description: 'Нет токена, он истёк или сессия отозвана' })
  async me(@Req() request: PlatformRequest): Promise<PlatformMeResult> {
    const adminId = request.platformAdminId

    if (adminId === undefined) {
      // Сюда не попасть: гвард уже отработал. Но молчаливое `!` в этом файле
      // стоило бы дороже одной строки.
      throw new UnauthorizedException('Требуется токен админки платформы')
    }

    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: adminId },
      select: { id: true, email: true, displayName: true, lastSeenAt: true },
    })

    return {
      adminId: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      lastSeenAt: admin.lastSeenAt?.toISOString() ?? null,
    }
  }
}
