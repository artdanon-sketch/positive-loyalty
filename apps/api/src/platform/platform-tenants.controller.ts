import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { PlatformTenantsResult } from '@positive/contracts'

import { PlatformStatsService } from './platform-stats.service'
import { PlatformGuard } from './platform.guard'

/**
 * Заведения — главный экран панели.
 *
 * Отдельный контроллер, а не ещё один маршрут в контроллере входа. Первым
 * побуждением было дописать сюда `@Get('../tenants')` — и это работает
 * случайно, а не по замыслу: относительные пути в маршрутах Nest не обещает,
 * и однажды такой путь тихо переедет не туда.
 *
 * ЗДЕСЬ И ПРОЯВЛЯЕТСЯ ВЕСЬ СМЫСЛ ОТДЕЛЬНОЙ РОЛИ POSTGRES. Этот запрос видит
 * ВСЕ заведения сразу. Тот же самый код в основном API не увидел бы ни одного
 * чужого — не из-за проверки в коде, а потому, что его роль в базе так не умеет.
 */
@ApiTags('platform')
@Controller('platform')
export class PlatformTenantsController {
  constructor(private readonly stats: PlatformStatsService) {}

  @Get('tenants')
  @UseGuards(PlatformGuard)
  @ApiOperation({ summary: 'Все заведения с цифрами' })
  @ApiResponse({ status: 200, description: 'Список заведений и сводка' })
  @ApiResponse({ status: 401, description: 'Нет токена, он истёк или сессия отозвана' })
  async tenants(): Promise<PlatformTenantsResult> {
    return this.stats.tenants(new Date())
  }
}
