import { SetMetadata, type CustomDecorator } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'positive:isPublic'

/**
 * Помечает маршрут как публичный — доступный без токена.
 *
 * Умолчание обратное: TenantGuard подключён глобально и закрывает ВСЁ.
 * Забыть повесить защиту нельзя, можно только осознанно её снять — и это
 * видно в диффе одной строкой. Обратный подход («вешаем гвард там, где нужно»)
 * ломается на первом же новом контроллере, который просто забыли закрыть.
 *
 * Сейчас публичных маршрута два: health-check и вебхуки POS, у которых своя
 * проверка подписи вместо токена.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true)
