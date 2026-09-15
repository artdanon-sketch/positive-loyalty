import { NotFoundException } from '@nestjs/common'

import { TenantContext } from '../common/tenant/tenant-context'

/**
 * Гость текущего запроса. Одна проверка на все гостевые сервисы.
 *
 * За GuestGuard гость есть всегда; исключение — страховка от вызова мимо гварда,
 * и оно не должно выдавать, что за адресом что-то есть.
 */
export const currentGuestId = (): string => {
  const guestId = TenantContext.getOrThrow().guestId

  if (guestId === null) {
    throw new NotFoundException({
      error: { code: 'NOT_FOUND', message: 'Гость не найден' },
    })
  }

  return guestId
}
