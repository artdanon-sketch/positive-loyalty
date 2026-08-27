import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { PosWebhookAccepted } from '@positive/contracts'
import type { Request } from 'express'

import { Public } from '../common/tenant/public.decorator'

import { PosWebhookService } from './pos-webhook.service'

/**
 * Вебхуки от POSitive POS. docs/02, раздел 4.
 *
 * ЭНДПОИНТ ПУБЛИЧНЫЙ — в том смысле, что без нашего токена. Отправитель
 * доказывает себя подписью HMAC по ключу конкретного заведения, а не Bearer:
 * касса — не пользователь, и сессии у неё нет. Изоляция при этом никуда
 * не девается: `tenantId` берётся из связи, найденной по подписанному
 * `posMerchantId`, и снаружи его назвать нельзя (железное правило 2).
 *
 * ОТВЕТ 202, А НЕ 200. ТЗ прямо оговаривает: «2xx не означает „баллы
 * начислены“ — означает „событие принято“». Двести второй код именно это
 * и значит, и касса по нему ничего не дорисовывает.
 */
@ApiTags('webhooks')
@Controller('webhooks/pos')
export class PosWebhookController {
  constructor(private readonly webhooks: PosWebhookService) {}

  @Post('receipt-closed')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Чек закрыт на кассе' })
  @ApiAcceptedResponse({ description: 'Событие принято в обработку' })
  @ApiUnauthorizedResponse({ description: 'Подпись или отправитель не приняты' })
  async receiptClosed(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-positive-signature') signature?: string,
    @Headers('x-positive-timestamp') timestamp?: string,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<PosWebhookAccepted> {
    return this.accept(request, signature, timestamp, idempotencyKey)
  }

  /**
   * Отмена чека. Тот же конверт и та же проверка (docs/02, раздел 4.2),
   * поэтому и обработчик тот же: вид события лежит внутри тела и разбирается
   * после проверки подписи. Отдельный маршрут существует лишь потому, что
   * так его описывает касса.
   */
  @Post('receipt-voided')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Чек отменён на кассе' })
  @ApiAcceptedResponse({ description: 'Событие принято в обработку' })
  @ApiUnauthorizedResponse({ description: 'Подпись или отправитель не приняты' })
  async receiptVoided(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-positive-signature') signature?: string,
    @Headers('x-positive-timestamp') timestamp?: string,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<PosWebhookAccepted> {
    return this.accept(request, signature, timestamp, idempotencyKey)
  }

  private async accept(
    request: RawBodyRequest<Request>,
    signature: string | undefined,
    timestamp: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<PosWebhookAccepted> {
    // СЫРЫЕ БАЙТЫ, а не разобранное и снова собранное тело. Подпись считается
    // по тому, что отправитель послал: другой порядок ключей, другие пробелы —
    // и хеш не сойдётся. Буфер даёт `rawBody: true` в bootstrap.
    const rawBody = request.rawBody ?? Buffer.alloc(0)

    return this.webhooks.accept({ rawBody, signature, timestamp, idempotencyKey })
  }
}
