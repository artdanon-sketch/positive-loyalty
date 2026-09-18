import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { GuestCatalog } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestCatalogService } from './guest-catalog.service'
import { GuestGuard } from './guest.guard'

/** Что можно взять за баллы. docs/02, раздел 2.13. */
@ApiTags('guest')
@Controller('guest/catalog')
@Public()
@UseGuards(GuestGuard)
export class GuestCatalogController {
  constructor(private readonly catalog: GuestCatalogService) {}

  @Get()
  @ApiOperation({
    summary: 'Витрина «что взять за баллы» по всем заведениям гостя',
    description: 'Только позиции с ценой в баллах; у каждой сказано, хватает ли гостю баллов.',
  })
  @ApiOkResponse({ description: 'Позиции витрины' })
  async list(): Promise<GuestCatalog> {
    return this.catalog.list()
  }
}
