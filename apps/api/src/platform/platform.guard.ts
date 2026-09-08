import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'

import { readBearerToken } from '../common/tenant/access-token'

import { PlatformPrismaService } from './platform-prisma.service'
import { platformTokenSecret, verifyPlatformToken } from './platform-token'

/**
 * Пускает только с действующим токеном админки платформы.
 *
 * ─── ПОЧЕМУ ПРОВЕРЯЕТСЯ НЕ ТОЛЬКО ПОДПИСЬ ────────────────────────────────────
 *
 * Подпись говорит «токен выдали мы», но не говорит «сессия ещё жива». Между
 * выдачей и предъявлением владелец мог отозвать устройство или погасить сессию,
 * и токен обязан перестать работать в тот же миг, а не через пятнадцать минут.
 *
 * Для учётной записи, которая видит все заведения, «отзыв сработает через
 * четверть часа» — это не мелочь: именно эти пятнадцать минут и нужны тому,
 * у кого токен украли.
 *
 * Цена — один запрос в базу на каждый вызов. Для панели, которой пользуется
 * один человек, это ничто; для гостевого API такой размен был бы неверным,
 * и там его сознательно нет.
 *
 * ─── ЧЕГО ЭТОТ ГВАРД НЕ ДЕЛАЕТ ───────────────────────────────────────────────
 *
 * Не различает права внутри платформы: сегодня админ платформы один и может
 * всё, что доступно его роли Postgres. Когда появятся разные уровни доступа,
 * они добавятся сюда, а не размажутся по контроллерам.
 */

/** Что гвард кладёт в запрос для контроллеров. */
export interface PlatformRequest extends Request {
  platformAdminId?: string
  platformSessionId?: string
}

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly prisma: PlatformPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>()
    const token = readBearerToken(request.headers.authorization)

    if (token === null) {
      throw new UnauthorizedException('Требуется токен админки платформы')
    }

    let claims: { adminId: string; sessionId: string }

    try {
      claims = verifyPlatformToken(token, platformTokenSecret())
    } catch {
      // Наружу — один и тот же отказ. Причина («истёк» против «чужая подпись»)
      // остаётся в тексте исключения, который сюда не пробрасывается.
      throw new UnauthorizedException('Требуется токен админки платформы')
    }

    const session = await this.prisma.platformSession.findUnique({
      where: { id: claims.sessionId },
      select: {
        adminId: true,
        revokedAt: true,
        expiresAt: true,
        admin: { select: { isActive: true } },
      },
    })

    const now = new Date()

    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.adminId !== claims.adminId ||
      !session.admin.isActive
    ) {
      throw new UnauthorizedException('Требуется токен админки платформы')
    }

    request.platformAdminId = claims.adminId
    request.platformSessionId = claims.sessionId

    return true
  }
}
