import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { GuestMe, GuestQrToken, GuestWallet } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestGuard } from './guest.guard'
import { GuestService } from './guest.service'

/**
 * API гостя. docs/02, разделы 2.1–2.2.
 *
 * @Public снимает тенантный гвард — у гостя нет заведения;
 * GuestGuard ставит своё требование: гостевой токен в запросе.
 */
@ApiTags('guest')
@Controller('guest')
@Public()
@UseGuards(GuestGuard)
export class GuestController {
  constructor(private readonly guestService: GuestService) {}

  @Get('me')
  @ApiOperation({ summary: 'Профиль гостя' })
  async me(): Promise<GuestMe> {
    return this.guestService.me()
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Кошелёк: баллы во всех заведениях' })
  async wallet(): Promise<GuestWallet> {
    return this.guestService.wallet()
  }

  @Get('qr-token')
  @ApiOperation({
    summary: 'Токен для показа на кассе',
    description:
      'Короткоживущий и отдельного вида: перехваченный с экрана код не годится ' +
      'ни для входа, ни для гостевого API.',
  })
  qrToken(): GuestQrToken {
    return this.guestService.qrToken()
  }
}
