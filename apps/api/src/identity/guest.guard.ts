import { Injectable, UnauthorizedException, type CanActivate } from '@nestjs/common'

import { TenantContext } from '../common/tenant/tenant-context'

/**
 * Пускает только запросы с гостевым субъектом.
 *
 * Вешается на гостевые контроллеры ПОВЕРХ @Public(): @Public снимает
 * TenantGuard (у гостя нет заведения), а этот гвард ставит собственное
 * требование — гость в контексте. Staff-токен сюда не проходит: middleware
 * кладёт либо tenantId, либо guestId, но никогда оба сразу.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  canActivate(): boolean {
    const guestId = TenantContext.get()?.guestId ?? null

    if (guestId === null) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHORIZED', message: 'Нужен гостевой токен' },
      })
    }

    return true
  }
}
