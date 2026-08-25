import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@positive/contracts'

import { ROLES_KEY } from './roles.decorator'
import { TenantContext } from './tenant-context'

/**
 * Проверяет роль субъекта против списка из `@Roles()`.
 *
 * Порядок важен: этот гвард идёт ПОСЛЕ TenantGuard. К моменту проверки роли
 * уже известно, что токен валиден и заведение установлено, — иначе пришлось бы
 * различать «не аутентифицирован» и «не хватает прав» в одном месте.
 *
 * Здесь 403, а не 404, и это не противоречит правилу «чужой тенант отдаёт 404».
 * Правило про ЧУЖИЕ объекты: там 403 подтверждал бы их существование. Здесь
 * объект свой, заведение своё, не хватает именно прав — и честный 403 говорит
 * кассиру «позовите владельца», а не «такой страницы нет».
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (required === undefined || required.length === 0) {
      return true
    }

    const role = TenantContext.get()?.role ?? null

    if (role === null || !required.includes(role as Role)) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Недостаточно прав для этого действия',
        },
      })
    }

    return true
  }
}
