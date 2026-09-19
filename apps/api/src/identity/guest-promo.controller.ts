import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ClaimedPromoCertificate, PromoCertificate } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestGuard } from './guest.guard'
import { GuestPromoService } from './guest-promo.service'

/** Промо-сертификаты, которые гость забирает сам. docs/02, раздел 5.11. */
@ApiTags('guest')
@Controller('guest/promo')
@Public()
@UseGuards(GuestGuard)
export class GuestPromoController {
  constructor(private readonly promo: GuestPromoService) {}

  @Get()
  @ApiOperation({
    summary: 'Промо-сертификаты по всем заведениям гостя',
    description: 'Только включённые self-claim шаблоны; у каждого сказано, забран ли уже.',
  })
  @ApiOkResponse({ description: 'Доступные промо-сертификаты' })
  async list(): Promise<PromoCertificate[]> {
    return this.promo.list()
  }

  @Post(':offerId/claim')
  @ApiOperation({
    summary: 'Забрать промо-сертификат',
    description: 'Выдаёт гостю промокод в кошелёк. Повтор возвращает тот же — один на гостя.',
  })
  @ApiCreatedResponse({ description: 'Выданный промокод' })
  async claim(@Param('offerId') offerId: string): Promise<ClaimedPromoCertificate> {
    return this.promo.claim(offerId)
  }
}
