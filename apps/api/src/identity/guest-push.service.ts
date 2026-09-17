import { Injectable } from '@nestjs/common'
import type { PushSubscribeInput } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

import { currentGuestId } from './current-guest'

/**
 * Подписки гостя на уведомления. docs/02, раздел 2.10.
 *
 * ГРАНИЦУ ДЕРЖИТ БАЗА: политика `guest_push` (миграция 20260918100000) отдаёт
 * гостю только его строки. Условия ниже — чтобы запрос читался, а не чтобы
 * удержать границу.
 *
 * ПОВТОРНАЯ ПОДПИСКА — ЭТО ОБНОВЛЕНИЕ. Браузер выдаёт тот же адрес, пока гость
 * не снёс приложение; заводить вторую строку значило бы слать ему два одинаковых
 * уведомления. Заодно снимается пометка «подписки больше нет»: гость вернулся.
 */
@Injectable()
export class GuestPushService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(input: PushSubscribeInput): Promise<void> {
    const guestId = currentGuestId()

    await this.prisma.forGuest(guestId, async (tx) => {
      await tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          guestId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
        },
        update: {
          guestId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          goneAt: null,
        },
      })
    })
  }

  /**
   * Отписать устройство.
   *
   * Неизвестный адрес — тоже успех: гость просил тишины и получил её, а отказ
   * в этом месте заставил бы приложение показывать ошибку на действие, которое
   * уже случилось.
   */
  async unsubscribe(endpoint: string): Promise<void> {
    const guestId = currentGuestId()

    await this.prisma.forGuest(guestId, async (tx) => {
      await tx.pushSubscription.deleteMany({ where: { endpoint, guestId } })
    })
  }
}
