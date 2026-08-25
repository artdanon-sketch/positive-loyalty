import { randomUUID } from 'node:crypto'

import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import { getEnv } from '../config/env'

import { readBearerToken, verifyAccessToken } from './access-token'
import { TenantContext } from './tenant-context'
import { AccessTokenInvalidError } from './tenant.errors'

/**
 * Устанавливает контекст тенанта на всё время обработки запроса.
 *
 * ПОЧЕМУ MIDDLEWARE, А НЕ ГВАРД. В ТЗ (docs/01, раздел 5) сказано «TenantGuard,
 * который кладёт tenantId в AsyncLocalStorage», но буквально так сделать нельзя:
 * `canActivate` возвращает решение и завершается, а `storage.run()` замыкает
 * контекст только на переданную функцию — до обработчика он не доживёт.
 * Остаётся `enterWith`, поведение которого в цепочке guard → interceptor → handler
 * зависит от того, на каком асинхронном ресурсе он вызван.
 *
 * Поэтому обязанности разделены: middleware ОТКРЫВАЕТ контекст и оборачивает
 * им весь дальнейший конвейер, а TenantGuard ПРИНИМАЕТ РЕШЕНИЕ — пускать или нет.
 * Разделение полезно и само по себе: контекст нужен даже там, где доступ публичный
 * (сквозной requestId в логах), а решение о доступе принимается не всегда.
 *
 * Middleware НЕ отклоняет запросы. Плохой токен — это отсутствие контекста,
 * а `401` отдаёт гвард. Иначе публичные маршруты вроде `/health` пришлось бы
 * перечислять в двух местах и однажды они разъедутся.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  /**
   * Секрет читается из конфигурации, а не приходит аргументом конструктора:
   * NestJS создаёт middleware через DI, и строковый параметр ему нечем разрешить.
   * `getEnv()` кэширован, обращение на каждый запрос ничего не стоит.
   */
  private get secret(): string {
    return getEnv().accessTokenSecret
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Сквозная трассировка. Свой идентификатор принимаем от клиента, но только
    // безопасной формы: чужая строка уедет в логи и заголовок ответа.
    const incoming = req.header('X-Request-Id')
    const requestId =
      typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)
        ? incoming
        : randomUUID()

    res.setHeader('X-Request-Id', requestId)

    const token = readBearerToken(req.header('Authorization'))

    if (token === null) {
      // Контекста тенанта нет — это нормально для публичных маршрутов.
      TenantContext.run({ tenantId: '', actorId: null, role: null, requestId }, () => {
        next()
      })
      return
    }

    try {
      const claims = verifyAccessToken(token, this.secret)
      TenantContext.run(
        {
          tenantId: claims.tenantId,
          actorId: claims.actorId,
          role: claims.role,
          requestId,
        },
        () => {
          next()
        },
      )
    } catch (error) {
      if (!(error instanceof AccessTokenInvalidError)) {
        throw error
      }

      // Токен есть, но негодный: идём дальше БЕЗ тенанта. Гвард ответит 401.
      // Причину наружу не отдаём — она отличает «просрочен» от «подпись не сошлась».
      TenantContext.run({ tenantId: '', actorId: null, role: null, requestId }, () => {
        next()
      })
    }
  }
}
