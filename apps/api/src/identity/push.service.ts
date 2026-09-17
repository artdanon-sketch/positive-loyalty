import { Injectable, Logger } from '@nestjs/common'
import webpush from 'web-push'

import { getEnv } from '../common/config/env'
import { PrismaService } from '../core/prisma.service'

/**
 * Уведомления в приложении гостя (Web Push). docs/02, раздел 2.10.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Приложение на телефоне без уведомлений — закладка: гость
 * поставил карту и больше никогда её не откроет, потому что повода нет. До сих
 * пор написать можно было только тем, кто связал Telegram; остальные считались
 * недостижимыми и в предпросмотре рассылки шли в колонку «некуда слать».
 *
 * БЕЗ КЛЮЧЕЙ СЕРВИС МОЛЧИТ, а не падает: на сервере без VAPID_* всё остальное
 * обязано работать. Это ровно то же правило, что у Telegram-бота рядом.
 *
 * «ПОДПИСКИ БОЛЬШЕ НЕТ» — НЕ ОШИБКА. Служба доставки отвечает 404 или 410,
 * когда гость снёс приложение или запретил уведомления. Такую строку помечаем
 * `goneAt` и больше не трогаем: иначе каждая рассылка будет стучаться в мёртвые
 * адреса и копить «не доставлено» на пустом месте.
 */

export interface PushPayload {
  readonly title: string
  readonly body: string
  /** Куда ведёт нажатие на уведомление. Пусто — открыть карту. */
  readonly url?: string
}

/** Результат отправки: null — дошло, строка — причина отказа. */
export type PushOutcome = string | null

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)

  /** Ключи заданы — уведомления работают. Читается один раз на старте. */
  readonly enabled: boolean
  readonly publicKey: string

  constructor(private readonly prisma: PrismaService) {
    const env = getEnv()

    this.enabled =
      env.vapidPublicKey !== '' && env.vapidPrivateKey !== '' && env.vapidSubject !== ''
    this.publicKey = this.enabled ? env.vapidPublicKey : ''

    if (this.enabled) {
      webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)
    }
  }

  /**
   * Отправить уведомление на все живые устройства гостя.
   *
   * Возвращает null, если дошло хотя бы до одного: у человека может быть
   * телефон и планшет, и молчащий планшет не повод считать сообщение
   * недоставленным.
   */
  async sendToGuest(guestId: string, payload: PushPayload): Promise<PushOutcome> {
    if (!this.enabled) {
      return 'Уведомления не настроены'
    }

    // Владельцем базы: отправка идёт из фонового прохода, где гостевого
    // контекста нет, — так же, как отправка в Telegram.
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { guestId, goneAt: null },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })

    if (subscriptions.length === 0) {
      return 'Нет устройств с уведомлениями'
    }

    let delivered = 0
    let lastError = 'Не доставлено'

    for (const subscription of subscriptions) {
      const outcome = await this.deliver(subscription, payload)

      if (outcome === null) {
        delivered += 1
      } else {
        lastError = outcome
      }
    }

    return delivered > 0 ? null : lastError
  }

  private async deliver(
    subscription: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<PushOutcome> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        // Уведомление живёт сутки: сообщение «зайдите сегодня», пришедшее
        // через неделю, хуже неприсланного.
        { TTL: 24 * 60 * 60 },
      )

      await this.prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastSentAt: new Date() },
      })

      return null
    } catch (error) {
      const status = this.statusOf(error)

      if (status === 404 || status === 410) {
        await this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { goneAt: new Date() },
        })

        return 'Подписка отозвана устройством'
      }

      this.logger.warn(
        `Уведомление не ушло: ${error instanceof Error ? error.message : String(error)}`,
      )

      return error instanceof Error ? error.message.slice(0, 200) : 'Не доставлено'
    }
  }

  /** У ошибки web-push статус лежит полем, а не в тексте. */
  private statusOf(error: unknown): number | null {
    if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
      return null
    }

    const status = error.statusCode

    return typeof status === 'number' ? status : null
  }
}
