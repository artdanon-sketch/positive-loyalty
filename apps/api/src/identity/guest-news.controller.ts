import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { GuestNewsSeenInput } from '@positive/contracts'
import type { GuestNews, GuestNewsSeen } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestNewsService } from './guest-news.service'
import { GuestGuard } from './guest.guard'

/** Лента новостей заведений гостя. docs/02, раздел 2.9 · docs/11, У13. */
@ApiTags('guest')
@Controller('guest/news')
@Public()
@UseGuards(GuestGuard)
export class GuestNewsController {
  constructor(private readonly news: GuestNewsService) {}

  @Get()
  @ApiOperation({ summary: 'Новости заведений, где гость бывал, — свежие сверху' })
  @ApiOkResponse({ description: 'Только опубликованные; не больше двадцати' })
  async list(): Promise<GuestNews> {
    return this.news.list()
  }

  @Post('seen')
  @ApiOperation({
    summary: 'Отметить новости увиденными',
    description: 'Пачкой. Повтор ничего не меняет: просмотр считается один раз на гостя.',
  })
  @ApiOkResponse({ description: 'counted — сколько отметок легло впервые' })
  @ApiBadRequestResponse({ description: 'Пустой список, не идентификаторы или длиннее ленты' })
  async seen(@Body() body: unknown): Promise<GuestNewsSeen> {
    const parsed = GuestNewsSeenInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.news.markSeen(parsed.data)
  }
}
