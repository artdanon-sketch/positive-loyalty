import { Catch, Logger } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

import { LedgerError } from '../../core/ledger.errors'

/**
 * Ответ на ошибку журнала баллов, которую сервис не перехватил сам.
 *
 * Каждая ошибка журнала знает свой код и статус (core/ledger.errors.ts), но
 * наследует обычный Error, а не HttpException. Без этого фильтра Nest отдавал
 * их как голое «500 Internal server error»: касса при гонке двух списаний,
 * при отмене чека с уже потраченными баллами или при чужом гостем видела
 * «сервер сломался» вместо «баллов не хватает» или «гость не найден».
 *
 * Тело — в общем виде API, `{ error: { code, message } }`. Подробности
 * (`details`) наружу не отдаём: там бывают идентификаторы.
 *
 * Внутренние ошибки (расхождение кэша баланса с журналом) остаются 500 и
 * без текста наружу — это поломка у нас, а не ошибка запроса; подробности
 * уходят в лог.
 */
@Catch(LedgerError)
export class LedgerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LedgerExceptionFilter.name)

  catch(error: LedgerError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const internal = error.status >= 500

    if (internal) {
      this.logger.error(`${error.code}: ${error.message}`, error.stack)
    }

    response.status(error.status).json({
      error: {
        code: error.code,
        message: internal
          ? 'Внутренняя ошибка журнала баллов. Обратитесь в поддержку.'
          : error.message,
      },
    })
  }
}
