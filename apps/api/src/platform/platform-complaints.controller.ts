import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { PlatformComplaintsResult, PlatformComplaintsReviewResult } from '@positive/contracts'

import { PlatformComplaintsService } from './platform-complaints.service'
import { PlatformGuard, type PlatformRequest } from './platform.guard'

/**
 * Жалобы на спам в приглашениях: список и отметка «разобрано».
 * docs/07, раздел 6.2 · docs/02, раздел 6.
 *
 * Живёт только в процессе платформы: имена жалобщиков — то, что основной API
 * отдавать не должен никому, и роль его базы их и не прочитает.
 */
@ApiTags('platform')
@Controller('platform/invite-complaints')
@UseGuards(PlatformGuard)
export class PlatformComplaintsController {
  constructor(private readonly complaints: PlatformComplaintsService) {}

  @Get()
  @ApiOperation({ summary: 'Неразобранные жалобы на спам в приглашениях' })
  @ApiResponse({ status: 200, description: 'Заведения с жалобами, приостановленные первыми' })
  @ApiResponse({ status: 401, description: 'Нет токена, он истёк или сессия отозвана' })
  async list(): Promise<PlatformComplaintsResult> {
    return this.complaints.open()
  }

  @Post(':tenantId/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить жалобы на заведение разобранными' })
  @ApiResponse({ status: 200, description: 'Сколько жалоб отмечено; приостановка снята' })
  @ApiResponse({ status: 400, description: 'Идентификатор заведения — не UUID' })
  @ApiResponse({ status: 401, description: 'Нет токена, он истёк или сессия отозвана' })
  async review(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() request: PlatformRequest,
  ): Promise<PlatformComplaintsReviewResult> {
    const adminId = request.platformAdminId

    // Гвард кладёт админа всегда; отсутствие — поломка проводки, а не повод
    // отметить жалобы от имени «никого».
    if (adminId === undefined) {
      throw new UnauthorizedException('Требуется токен админки платформы')
    }

    return this.complaints.review(tenantId, adminId, new Date())
  }
}
