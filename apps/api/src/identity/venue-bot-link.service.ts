import { createHash, randomBytes } from 'node:crypto'

import { Injectable, NotFoundException } from '@nestjs/common'
import type { VenueBotInvite } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

import { currentGuestId } from './current-guest'

/**
 * Приглашение гостя в бота заведения. docs/02, раздел 2.14.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ НУЖНО. Telegram не даёт боту писать первым: пока гость
 * не нажал «Запустить» именно у бота кафе, сообщение ему не уйдёт. Ссылка
 * `t.me/<бот>?start=<код>` — единственный способ связать чат с картой.
 *
 * КОД ОДНОРАЗОВЫЙ И КОРОТКОЖИВУЩИЙ. Он предъявляется вместо подписи: кто его
 * знает, тот подключит свой Telegram к чужой карте и начнёт получать чужие
 * сообщения. Поэтому в базе — только хеш, срок жизни — час, и второй раз
 * код не сработает.
 *
 * СТАРЫЕ ПРИГЛАШЕНИЯ ГАСНУТ ПРИ ВЫДАЧЕ НОВОГО: гость, дважды нажавший кнопку,
 * не должен оставлять за собой хвост действующих ссылок.
 */

/** Час: ссылку открывают сразу или не открывают вовсе. */
const TTL_MS = 60 * 60 * 1000

const hash = (code: string): string => createHash('sha256').update(code).digest('hex')

@Injectable()
export class VenueBotLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(tenantId: string): Promise<VenueBotInvite> {
    const guestId = currentGuestId()

    // Бот читается владельцем базы: гостю таблица ботов недоступна, и это
    // правильно — там лежит ключ.
    const bot = await this.prisma.venueBot.findFirst({
      where: { tenantId, isActive: true },
      select: { username: true },
    })

    if (bot === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'У заведения нет своего бота' },
      })
    }

    const code = randomBytes(16).toString('base64url')

    await this.prisma.forGuest(guestId, async (tx) => {
      // Прошлые приглашения гасим: действующими остаются не все выданные,
      // а только последнее.
      await tx.venueBotLink.updateMany({
        where: { tenantId, guestId, usedAt: null },
        data: { usedAt: new Date() },
      })

      await tx.venueBotLink.create({
        data: {
          tenantId,
          guestId,
          codeHash: hash(code),
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      })
    })

    return { url: `https://t.me/${bot.username}?start=${code}`, botUsername: bot.username }
  }

  /**
   * Связать чат с картой по коду из `/start`.
   *
   * Возвращает `null`, когда код не подошёл: просрочен, уже использован или
   * выдан другим заведением. Боту в этом случае отвечаем общими словами —
   * различать причины наружу значит помогать подбирать код.
   */
  async claim(tenantId: string, code: string, chatId: string): Promise<{ guestId: string } | null> {
    const link = await this.prisma.venueBotLink.findFirst({
      where: { codeHash: hash(code), tenantId, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, guestId: true },
    })

    if (link === null) {
      return null
    }

    await this.prisma.$transaction([
      this.prisma.venueBotLink.update({ where: { id: link.id }, data: { usedAt: new Date() } }),
      // Повторное подключение того же гостя обновляет чат, а не заводит второй:
      // гость мог сменить телефон и запустить бота заново.
      this.prisma.venueBotChat.upsert({
        where: { tenantId_guestId: { tenantId, guestId: link.guestId } },
        create: { tenantId, guestId: link.guestId, chatId },
        update: { chatId, blockedAt: null },
      }),
    ])

    return { guestId: link.guestId }
  }
}
