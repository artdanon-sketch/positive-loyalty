import { Injectable, Logger } from '@nestjs/common'
import type { AutomationKind } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { audienceOf, newcomers } from './automation.service'
import { parseGift } from './broadcast-gift.service'
import { BroadcastsService } from './broadcasts.service'
import { GuestAudienceService } from './guest-audience.service'

/**
 * Запуск автоматических сценариев. docs/02, раздел 5.4.1.
 *
 * СЦЕНАРИЙ СОЗДАЁТ ОБЫЧНУЮ РАССЫЛКУ и на этом заканчивается. Дальше работает
 * машина рассылок: снимок аудитории, ограничение усталости, отправка порциями,
 * архив с итогами. Отдельный путь отправки означал бы, что «не больше четырёх
 * сообщений в месяц» считается только по одному из двух.
 *
 * НЕ ЧАЩЕ РАЗА В СУТКИ. Условие сценария — это состояние, а не событие: «не
 * заходил тридцать дней» верно и завтра, и послезавтра. Без этого правила гость
 * получал бы письмо каждые пятнадцать секунд — по проходу разгребателя.
 *
 * ОДИН РАЗ НА ГОСТЯ ЗА ЭПИЗОД (automation-episode.ts). Сценарий пишет только
 * тем, кто подошёл под условие и ещё не получал этот эпизод, и отмечает их
 * в той же транзакции, что и рассылку: рассылка без отметок повторилась бы
 * завтра — вместе с подарком.
 *
 * НЕКОМУ ПИСАТЬ — РАССЫЛКИ НЕТ. День отмечается, а пустая рассылка в архив не
 * пишется: при эпизодах «некому» — обычный день, и архив не должен зарастать
 * пустыми строками.
 */

/** Сколько сценариев берём за проход: их по три на заведение, спешить некуда. */
const BATCH = 10

const DAY_MS = 24 * 60 * 60 * 1000

const TITLES: Readonly<Record<AutomationKind, string>> = {
  SLEEPING: 'Автосценарий: давно не заходили',
  JOINED_NO_PURCHASE: 'Автосценарий: вступили, но не купили',
  SPENT_TOTAL: 'Автосценарий: спасибо за покупки',
}

export interface AutomationTickResult {
  readonly started: number
}

@Injectable()
export class AutomationRunService {
  private readonly logger = new Logger(AutomationRunService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcasts: BroadcastsService,
    private readonly audience: GuestAudienceService,
  ) {}

  async tick(now: Date = new Date()): Promise<AutomationTickResult> {
    const since = new Date(now.getTime() - DAY_MS)

    // Владельцем базы: разгребатель работает за все заведения сразу.
    const due = await this.prisma.automationRule.findMany({
      where: {
        enabled: true,
        OR: [{ lastRunAt: null }, { lastRunAt: { lt: since } }],
      },
      orderBy: { lastRunAt: 'asc' },
      take: BATCH,
      select: { id: true, tenantId: true, kind: true, threshold: true, text: true, gift: true },
    })

    let started = 0

    for (const rule of due) {
      const created = await this.start(rule, now)
      started += created ? 1 : 0
    }

    return { started }
  }

  private async start(
    rule: {
      id: string
      tenantId: string
      kind: AutomationKind
      threshold: number
      text: string
      gift: unknown
    },
    now: Date,
  ): Promise<boolean> {
    try {
      const claimed = await this.prisma.forTenant(rule.tenantId, async (tx) => {
        // Отметку ставим ПЕРВОЙ и только для тех, кто ещё не отмечен сегодня:
        // падение после создания рассылки повторило бы её завтра, а падение
        // после отметки — просто пропустило бы день. Пропустить день дешевле,
        // чем прислать гостю два одинаковых письма.
        const claimed = await tx.automationRule.updateMany({
          where: {
            id: rule.id,
            tenantId: rule.tenantId,
            OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - DAY_MS) } }],
          },
          data: { lastRunAt: now },
        })

        return claimed.count > 0
      })

      if (!claimed) {
        return false
      }

      const fresh = await this.prisma.forTenant(rule.tenantId, async (tx) =>
        newcomers(tx, this.audience, rule.tenantId, rule.kind, rule.threshold),
      )

      if (fresh.length === 0) {
        return false
      }

      const gift = parseGift(rule.gift)

      // Рассылку создаёт тот же сервис, что и владелец в бэк-офисе: снимок
      // аудитории, усталость и учёт доставки должны работать одинаково.
      // Автор — сам сценарий: сотрудника за этой рассылкой нет.
      await this.broadcasts.createFor(
        rule.tenantId,
        null,
        'SYSTEM',
        {
          title: TITLES[rule.kind],
          text: rule.text,
          audience: audienceOf(rule.kind, rule.threshold),
          ...(gift === null ? {} : { gift }),
        },
        {
          onlyGuestIds: fresh.map((row) => row.guestId),
          afterCreate: async (tx, broadcastId) => {
            await tx.automationHit.createMany({
              data: fresh.map((row) => ({
                tenantId: rule.tenantId,
                kind: rule.kind,
                guestId: row.guestId,
                episode: row.episode,
                broadcastId,
              })),
              skipDuplicates: true,
            })
          },
        },
      )

      return true
    } catch (error) {
      this.logger.warn(
        `Сценарий ${rule.kind} заведения ${rule.tenantId} не запущен: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )

      return false
    }
  }
}
