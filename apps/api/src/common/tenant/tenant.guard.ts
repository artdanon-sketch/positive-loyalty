import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { IS_PUBLIC_KEY } from './public.decorator'
import { TenantContext } from './tenant-context'

/**
 * Пускает дальше только запросы с установленным тенантом.
 *
 * Контекст открывает TenantContextMiddleware — здесь принимается решение.
 * Гвард подключён ГЛОБАЛЬНО: закрыто всё, открыто только помеченное `@Public()`.
 *
 * Требование приёмки Задачи 3 (docs/06, раздел 8): тест изоляции обязан падать
 * при намеренном отключении гварда. Отсюда флаг `disabledForTest` — не «чтобы
 * удобнее тестировать», а чтобы доказать, что тест проверяет именно защиту,
 * а не совпадение. Тест, который зелёный и с гвардом, и без него, не доказывает
 * ничего.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  /**
   * Аварийное отключение проверки. ТОЛЬКО для теста «страховка действительно ловит».
   * В обычном коде не трогать: отключённый гвард открывает доступ к чужим данным.
   */
  static disabledForTest = false

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (TenantGuard.disabledForTest) {
      return true
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (isPublic === true) {
      return true
    }

    const tenantId = TenantContext.get()?.tenantId ?? ''

    if (tenantId.length === 0) {
      // Единый ответ на «токена нет», «токен просрочен» и «подпись не сошлась».
      // Разные ответы на эти случаи — подсказка тому, кто подбирает.
      throw new UnauthorizedException({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Нужен действующий токен доступа',
        },
      })
    }

    return true
  }
}
