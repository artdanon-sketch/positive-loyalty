import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PushSubscribeInput, PushUnsubscribeInput } from '@positive/contracts'
import type { PushConfig, PushSubscribed } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestPushService } from './guest-push.service'
import { GuestGuard } from './guest.guard'
import { PushService } from './push.service'

/**
 * Уведомления в приложении гостя. docs/02, раздел 2.10.
 *
 * ПОДПИСКА ПРИНАДЛЕЖИТ ГОСТЮ, А НЕ ЗАВЕДЕНИЮ: карта одна на все места, где он
 * бывает, и разрешение на уведомления он даёт один раз.
 */
@ApiTags('guest')
@Controller('guest/push')
@Public()
@UseGuards(GuestGuard)
export class GuestPushController {
  constructor(
    private readonly push: PushService,
    private readonly subscriptions: GuestPushService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Открытый ключ для подписки на уведомления',
    description: 'enabled: false — уведомления на сервере не настроены, кнопку показывать не надо.',
  })
  @ApiOkResponse({ description: 'Ключ и признак включённости' })
  config(): PushConfig {
    return { enabled: this.push.enabled, publicKey: this.push.publicKey }
  }

  @Post('subscribe')
  @ApiOperation({
    summary: 'Подписать устройство на уведомления',
    description: 'Повтор с того же устройства обновляет ключи, а не заводит вторую подписку.',
  })
  @ApiOkResponse({ description: 'Подписка сохранена' })
  @ApiBadRequestResponse({ description: 'Адрес не адрес или ключи не похожи на ключи' })
  async subscribe(@Body() body: unknown): Promise<PushSubscribed> {
    const parsed = PushSubscribeInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    await this.subscriptions.subscribe(parsed.data)

    return { ok: true }
  }

  @Post('unsubscribe')
  @ApiOperation({
    summary: 'Отписать устройство',
    description: 'Отписка неизвестного устройства — тоже успех: гость хотел тишины и получил её.',
  })
  @ApiOkResponse({ description: 'Подписки больше нет' })
  @ApiBadRequestResponse({ description: 'Адрес не адрес' })
  async unsubscribe(@Body() body: unknown): Promise<PushSubscribed> {
    const parsed = PushUnsubscribeInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    await this.subscriptions.unsubscribe(parsed.data.endpoint)

    return { ok: true }
  }
}

const invalid = (
  issues: ReadonlyArray<{ readonly message: string; readonly path: readonly PropertyKey[] }>,
): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })
