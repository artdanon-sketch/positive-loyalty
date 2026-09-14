import { randomUUID } from 'node:crypto'

import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import { getEnv } from '../config/env'
import { PrismaService } from '../../core/prisma.service'

import { readBearerToken, verifyAccessToken, verifyGuestToken } from './access-token'
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
 *
 * ─── СОТРУДНИК ПРОВЕРЯЕТСЯ ПО БАЗЕ, А НЕ ТОЛЬКО ПО ТОКЕНУ ─────────────────────
 *
 * Токен сотрудника живёт восемь часов. Пока экрана «Команда» не было, это ничего
 * не значило: отключить сотрудника было нечем. Как только он появился, подпись
 * токена перестала быть достаточным доказательством:
 *
 *   уволенный кассир   продолжал бы начислять до конца смены — ровно тот случай,
 *                      ради которого его и увольняют;
 *   понижённый         менеджер сохранял бы право отменять чужие операции
 *                      восемь часов после того, как владелец его понизил.
 *
 * Поэтому для токена сотрудника строка сотрудника читается из базы до того,
 * как открыть контекст, и в контекст кладётся ЖИВАЯ роль, а не роль из токена.
 * Отключённый или удалённый сотрудник получает контекст без заведения — и тот же
 * `401`, что и просроченный токен. Клиент попробует обновить сессию, обновление
 * тоже откажет (auth.service проверяет isActive), и человек окажется на экране
 * входа.
 *
 * Роль проверяется здесь, а не в RolesGuard, потому что контекст неизменяем:
 * гвард мог бы отказать по живой роли, но всё, что читает роль ниже по
 * конвейеру — маскирование телефона, отмены в окне, — видело бы роль из токена.
 * Две правды о правах в одном запросе хуже одной устаревшей.
 *
 * ЦЕНА — один запрос по первичному ключу на каждый запрос сотрудника. Это
 * осознанно: касса делает несколько запросов на чек, и лишняя миллисекунда там
 * дешевле восьми часов доступа у уволенного человека.
 *
 * ТОКЕН БЕЗ actorId НЕ ПРОВЕРЯЕТСЯ ПО БАЗЕ. Сервер таких не выдаёт: вход по PIN
 * всегда кладёт идентификатор сотрудника. Они встречаются только в тестах, где
 * токен подписан напрямую, — а подписать токен можно лишь зная секрет, и с ним
 * подделывается что угодно. Проверка по базе не защищает от владельца секрета
 * и не должна делать вид, что защищает.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Секрет читается из конфигурации, а не приходит аргументом конструктора:
   * NestJS создаёт middleware через DI, и строковый параметр ему нечем разрешить.
   * `getEnv()` кэширован, обращение на каждый запрос ничего не стоит.
   */
  private get secret(): string {
    return getEnv().accessTokenSecret
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Сквозная трассировка. Свой идентификатор принимаем от клиента, но только
    // безопасной формы: чужая строка уедет в логи и заголовок ответа.
    const incoming = req.header('X-Request-Id')
    const requestId =
      typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)
        ? incoming
        : randomUUID()

    res.setHeader('X-Request-Id', requestId)

    const anonymous = (): void => {
      TenantContext.run(
        { tenantId: '', actorId: null, role: null, guestId: null, requestId },
        () => {
          next()
        },
      )
    }

    const token = readBearerToken(req.header('Authorization'))

    if (token === null) {
      // Контекста тенанта нет — это нормально для публичных маршрутов.
      anonymous()
      return
    }

    let staffClaims: ReturnType<typeof verifyAccessToken> | null = null

    try {
      staffClaims = verifyAccessToken(token, this.secret)
    } catch (staffError) {
      if (!(staffError instanceof AccessTokenInvalidError)) {
        next(staffError)
        return
      }
      // Не сотрудник — возможно, гость: у гостевого токена нет tenantId,
      // и staff-проверка честно его отвергает. Пробуем вторую форму.
    }

    if (staffClaims !== null) {
      let role = staffClaims.role

      if (staffClaims.actorId !== null) {
        let live: { role: string } | null

        try {
          live = await this.liveStaff(staffClaims.tenantId, staffClaims.actorId)
        } catch (error) {
          // База не ответила. Не пропускаем по подписи «на всякий случай»:
          // это ровно та ситуация, в которой отключённый сотрудник прошёл бы.
          // Ошибка уходит в обработчик Nest и превращается в 500 — громко.
          next(error)
          return
        }

        if (live === null) {
          // Сотрудник отключён или его нет. Для гварда это «нет действующего
          // токена», и ответ неотличим от просроченного.
          anonymous()
          return
        }

        role = live.role
      }

      TenantContext.run(
        {
          tenantId: staffClaims.tenantId,
          actorId: staffClaims.actorId,
          role,
          guestId: null,
          requestId,
        },
        () => {
          next()
        },
      )
      return
    }

    try {
      const guest = verifyGuestToken(token, this.secret)
      TenantContext.run(
        { tenantId: '', actorId: null, role: null, guestId: guest.guestId, requestId },
        () => {
          next()
        },
      )
    } catch (error) {
      if (!(error instanceof AccessTokenInvalidError)) {
        next(error)
        return
      }

      // Токен есть, но не подошёл ни одной форме: идём дальше без субъекта.
      // 401 отдаст гвард; причину наружу не отдаём.
      anonymous()
    }
  }

  /** Живой сотрудник заведения или `null`, если его нет или он отключён. */
  private async liveStaff(tenantId: string, staffId: string): Promise<{ role: string } | null> {
    return this.prisma.forTenant(tenantId, async (tx) =>
      tx.staff.findFirst({
        where: { id: staffId, tenantId, isActive: true },
        select: { role: true },
      }),
    )
  }
}
