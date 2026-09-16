import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { GuestNews } from '@positive/contracts'

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
}
