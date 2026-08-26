import { SetMetadata, type CustomDecorator } from '@nestjs/common'
import type { Role } from '@positive/contracts'

export const ROLES_KEY = 'positive:roles'

/**
 * Ограничивает маршрут ролями из docs/05, раздел 3.
 *
 * «Проверка роли — на уровне функции, а не только интерфейса. Скрытая кнопка
 * не является защитой» — оттуда же дословно.
 *
 * Без декоратора маршрут доступен любой роли своего заведения: изоляция
 * заведений и права внутри заведения — разные вещи, и смешивать их не надо.
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles)
