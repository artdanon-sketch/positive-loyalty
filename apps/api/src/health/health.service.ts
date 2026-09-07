import { Injectable } from '@nestjs/common'
import { HealthResponse } from '@positive/contracts'

import { getEnv } from '../common/config/env'

/**
 * Health-check: единственная бизнес-логика, которая пока есть у API.
 *
 * Ответ валидируется схемой из `@positive/contracts` — контракт один и тот же
 * для сервера, тестов и любых внешних потребителей (Railway смотрит на этот эндпоинт).
 */
const SERVICE_NAME = 'api'

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now()

  check(): HealthResponse {
    const payload: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: getEnv().appVersion,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      logins: {
        // Пустой ключ приложения означает выключенный вход, а не «как-нибудь
        // да заработает»: без него нечем сверить, кому выписан токен.
        google: getEnv().googleClientId !== '',
        // Нет ключа бота — нет и входа через Telegram. Приложение читает это
        // поле и не рисует кнопку, которая заведомо не сработает.
        telegram: getEnv().telegramBotToken !== '',
        // Вход по коду подтверждения есть всегда, но код пока никуда
        // не отправляется — канала доставки нет. Считать его рабочим нельзя.
        phone: false,
      },
    }

    return HealthResponse.parse(payload)
  }
}
