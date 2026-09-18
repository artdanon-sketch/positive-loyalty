import { Injectable, Logger } from '@nestjs/common'

import { getEnv } from '../common/config/env'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { PushService } from '../identity/push.service'
import { TelegramApi } from '../identity/telegram-api'
import { TelegramBotService } from '../identity/telegram-bot.service'

/**
 * Отправка рассылок. docs/02, раздел 5.4.
 *
 * ПОРЦИЯМИ И В ФОНЕ. Запрос владельца не ждёт тысячу обращений к Telegram:
 * «отправить» создаёт список получателей, а сюда приходит фоновый проход.
 *
 * ОДИН ПОЛУЧАТЕЛЬ — ОДНА СТРОКА, и она обновляется сразу после ответа Telegram.
 * Проход, упавший посередине, не отправит уже отправленное второй раз: следующий
 * возьмёт только тех, кто остался в PENDING.
 *
 * СВОЙ БОТ ЗАВЕДЕНИЯ — ПЕРВЫЙ ИЗ КАНАЛОВ. Сообщение от «Kata Beach Kitchen»
 * читают иначе, чем сообщение от «POSitive Loyalty»: от имени отправителя
 * зависит, откроют его или отпишутся. Если гость запустил бота кафе — пишем
 * туда, и только иначе через общего.
 *
 * ДВА КАНАЛА, TELEGRAM ПЕРВЫЙ. В Telegram сообщение остаётся в переписке и его
 * можно перечитать; уведомление в приложении живёт до первого нажатия. Поэтому
 * тем, у кого связан Telegram, шлём туда, а уведомление — тем, у кого его нет,
 * но кто поставил карту на телефон. Двух каналов одному человеку не бывает:
 * это одно сообщение, а не два.
 *
 * ОТКАЗ TELEGRAM — НЕ ПОЛОМКА РАССЫЛКИ. Гость, закрывший бота, отвечает ошибкой
 * «bot was blocked»; это судьба одного получателя, а не повод остановить остальные.
 * Текст ошибки сохраняется — владельцу в архиве видно, почему не дошло.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, как и остальные разгребатели (docs/09, Э3).
 */

/** Сколько сообщений отправляем за один проход: у Telegram предел около 30 в секунду. */
const BATCH = 20

/** Сколько рассылок берём за проход: обычно работает одна, но очередь не должна вставать. */
const BROADCASTS_PER_TICK = 3

export interface BroadcastTickResult {
  readonly sent: number
  readonly failed: number
}

@Injectable()
export class BroadcastSendService {
  private readonly logger = new Logger(BroadcastSendService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramBotService,
    private readonly push: PushService,
  ) {}

  /**
   * Один проход: отправить то, что созрело.
   *
   * Заведения берутся из самих рассылок, а не перебором всех: заведение без
   * рассылок не должно стоить ни одного запроса.
   */
  async tick(now: Date = new Date()): Promise<BroadcastTickResult> {
    if (!this.telegram.enabled && !this.push.enabled) {
      // Ни бота, ни ключей уведомлений — слать нечем. Молчим: это состояние
      // среды, а не сбой.
      return { sent: 0, failed: 0 }
    }

    // Владельцем базы, без tenant-контекста: разгребатель работает за все заведения
    // сразу. Дальше каждая рассылка обрабатывается внутри forTenant своего заведения.
    const due = await this.prisma.broadcast.findMany({
      where: { status: { in: ['SCHEDULED', 'SENDING'] }, sendAt: { lte: now } },
      orderBy: [{ sendAt: 'asc' }, { id: 'asc' }],
      take: BROADCASTS_PER_TICK,
      select: { id: true, tenantId: true, text: true },
    })

    let sent = 0
    let failed = 0

    for (const broadcast of due) {
      const result = await this.send(broadcast.tenantId, broadcast.id, broadcast.text, now)
      sent += result.sent
      failed += result.failed
    }

    return { sent, failed }
  }

  private async send(
    tenantId: string,
    broadcastId: string,
    text: string,
    now: Date,
  ): Promise<BroadcastTickResult> {
    const pending = await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.broadcast.updateMany({
        where: { id: broadcastId, tenantId, status: 'SCHEDULED' },
        data: { status: 'SENDING', startedAt: now },
      })

      return this.batch(tx, tenantId, broadcastId)
    })

    if (pending.length === 0) {
      await this.finish(tenantId, broadcastId, now)
      return { sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0

    const brandName = await this.brandName(tenantId)
    const venueBot = await this.venueBot(tenantId)

    for (const recipient of pending) {
      // Свой бот заведения — первым: сообщение от кафе читают иначе, чем
      // сообщение от сервиса.
      const viaVenue = venueBot !== null && recipient.venueChatId !== null

      const outcome = viaVenue
        ? await this.deliverVia(venueBot, recipient.venueChatId ?? '', text)
        : recipient.chatId === null
          ? await this.push.sendToGuest(recipient.guestId, { title: brandName, body: text })
          : await this.deliver(recipient.chatId, text)

      const channel = viaVenue ? 'VENUE_BOT' : recipient.chatId === null ? 'PUSH' : 'TELEGRAM'

      await this.prisma.forTenant(tenantId, async (tx) =>
        tx.broadcastRecipient.updateMany({
          where: { id: recipient.id, tenantId },
          data:
            outcome === null
              ? { delivery: 'SENT', channel, sentAt: new Date() }
              : { delivery: 'FAILED', channel, error: outcome },
        }),
      )

      if (outcome === null) {
        sent += 1
      } else {
        failed += 1
      }
    }

    return { sent, failed }
  }

  /**
   * Очередная порция: получатели, которым ещё не слали, вместе с каналом.
   *
   * `chatId: null` означает «шлём уведомлением в приложение»: Telegram у гостя
   * нет, но устройство с подпиской есть.
   */
  private async batch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    broadcastId: string,
  ): Promise<
    Array<{ id: string; guestId: string; chatId: string | null; venueChatId: string | null }>
  > {
    const rows = await tx.broadcastRecipient.findMany({
      where: { tenantId, broadcastId, delivery: 'PENDING' },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, guestId: true },
    })

    if (rows.length === 0) {
      return []
    }

    const guestIds = rows.map((row) => row.guestId)

    const [identities, devices, venueChats] = await Promise.all([
      this.telegram.enabled
        ? tx.guestIdentity.findMany({
            where: { guestId: { in: guestIds }, provider: 'TELEGRAM' },
            select: { guestId: true, externalId: true },
          })
        : Promise.resolve([]),
      this.push.enabled
        ? tx.pushSubscription.findMany({
            where: { guestId: { in: guestIds }, goneAt: null },
            select: { guestId: true },
            distinct: ['guestId'],
          })
        : Promise.resolve([]),
      // Чаты у бота самого заведения: им пишем в первую очередь.
      tx.venueBotChat.findMany({
        where: { tenantId, guestId: { in: guestIds }, blockedAt: null },
        select: { guestId: true, chatId: true },
      }),
    ])

    const chats = new Map(identities.map((identity) => [identity.guestId, identity.externalId]))
    const ownChats = new Map(venueChats.map((chat) => [chat.guestId, chat.chatId]))
    const withDevice = new Set(devices.map((device) => device.guestId))

    // Гость мог отвязать Telegram и снести приложение между созданием рассылки
    // и отправкой — это не ошибка доставки, а исчезнувший канал.
    const gone = rows
      .filter(
        (row) =>
          !chats.has(row.guestId) && !withDevice.has(row.guestId) && !ownChats.has(row.guestId),
      )
      .map((row) => row.id)

    if (gone.length > 0) {
      await tx.broadcastRecipient.updateMany({
        where: { id: { in: gone }, tenantId },
        data: { delivery: 'SKIPPED_NO_CHANNEL' },
      })
    }

    return rows.flatMap(
      (
        row,
      ): Array<{
        id: string
        guestId: string
        chatId: string | null
        venueChatId: string | null
      }> => {
        const venueChatId = ownChats.get(row.guestId) ?? null
        const chatId = chats.get(row.guestId) ?? null

        if (venueChatId !== null || chatId !== null) {
          return [{ id: row.id, guestId: row.guestId, chatId, venueChatId }]
        }

        return withDevice.has(row.guestId)
          ? [{ id: row.id, guestId: row.guestId, chatId: null, venueChatId: null }]
          : []
      },
    )
  }

  /** Ключ бота заведения. null — своего бота нет, шлём как раньше. */
  private async venueBot(tenantId: string): Promise<string | null> {
    const bot = await this.prisma.venueBot.findFirst({
      where: { tenantId, isActive: true },
      select: { token: true },
    })

    return bot?.token ?? null
  }

  /**
   * Отправка через бота заведения.
   *
   * Отказ «гость заблокировал бота» помечает чат: писать в него дальше значит
   * копить «не доставлено» на пустом месте.
   */
  private async deliverVia(token: string, chatId: string, text: string): Promise<string | null> {
    try {
      await new TelegramApi(token).sendMessage(chatId, text)

      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (message.includes('blocked') || message.includes('bot was blocked')) {
        await this.prisma.venueBotChat.updateMany({
          where: { chatId },
          data: { blockedAt: new Date() },
        })
      }

      return message.slice(0, 200)
    }
  }

  /** Имя заведения — заголовок уведомления: гость должен видеть, от кого оно. */
  private async brandName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandName: true },
    })

    return tenant?.brandName ?? 'POSitive'
  }

  /**
   * Отправить одному. null — дошло, строка — причина отказа.
   *
   * С кнопкой «Открыть карту», если адрес приложения задан: гость читает
   * сообщение здесь и сейчас, и заставлять его искать бота в списке чатов
   * значит потерять половину тех, кто уже собрался зайти.
   */
  private async deliver(chatId: string, text: string): Promise<string | null> {
    const card = getEnv().guestAppUrl

    try {
      if (card === '') {
        await this.telegram.api.sendMessage(chatId, text)
      } else {
        await this.telegram.api.sendMessageWithCard(chatId, text, {
          text: 'Открыть карту',
          url: card,
        })
      }

      return null
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
    }
  }

  /** Рассылка закрывается, когда не осталось никого в ожидании. */
  private async finish(tenantId: string, broadcastId: string, now: Date): Promise<void> {
    await this.prisma.forTenant(tenantId, async (tx) => {
      const left = await tx.broadcastRecipient.count({
        where: { tenantId, broadcastId, delivery: 'PENDING' },
      })

      if (left > 0) {
        return
      }

      await tx.broadcast.updateMany({
        where: { id: broadcastId, tenantId, status: { in: ['SCHEDULED', 'SENDING'] } },
        data: { status: 'SENT', finishedAt: now },
      })
    })

    this.logger.log(`Рассылка ${broadcastId} отправлена`)
  }
}
