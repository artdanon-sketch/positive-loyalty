import { Injectable, Logger } from '@nestjs/common'
import { parseProgramConfig } from '@positive/contracts'

import { PrismaService } from './prisma.service'
import { decideStaffReward, vestsImmediately } from './staff-reward'
import type { Prisma } from '../generated/prisma/client'

/**
 * Награды кассирам: разбор чеков и дозревание. docs/03, раздел 6.
 *
 * СОБЫТИЕ ВЫВОДИТСЯ ИЗ ЖУРНАЛА, А НЕ ПИШЕТСЯ РЯДОМ С НИМ — тот же приём, что
 * у партнёрских триггеров и исходящих вебхуков. Чек в журнале долговечен,
 * поэтому «чек есть, награда не начислена» — состояние, из которого всегда
 * можно доехать. Зов из кассового пути терял бы награду молча при падении
 * между записью чека и записью награды.
 *
 * ОТКАЗ ТОЖЕ ЗАПИСЫВАЕТСЯ СТРОКОЙ. Иначе чек, за который платить не положено,
 * разбирался бы каждым проходом заново — и кассир не узнал бы, почему ему
 * не заплатили. Снятая награда остаётся в истории с причиной.
 *
 * ТРИ ДЕЙСТВИЯ ЗА ПРОХОД: разобрать новые чеки, дозреть тем, чей гость пришёл
 * второй раз, снять награды за отменённые чеки. Все три идут по своим таблицам
 * и не мешают друг другу.
 */

/** Сколько чеков разбираем за проход. Больше — дольше держим соединение. */
const BATCH_SIZE = 25

/** Окно разбора: сутки. Вчерашняя награда за позавчерашний чек никому не нужна. */
const WINDOW_HOURS = 24

const DAY_MS = 24 * 60 * 60 * 1000

export interface RewardsTickResult {
  readonly decided: number
  readonly vested: number
  readonly cancelled: number
}

interface ReceiptRow {
  id: string
  tenantId: string
  guestId: string
  membershipId: string
  actorId: string | null
  amount: number
  basisAmount: number | null
  createdAt: Date
}

@Injectable()
export class StaffRewardsService {
  private readonly logger = new Logger(StaffRewardsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async tick(now: Date = new Date()): Promise<RewardsTickResult> {
    const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

    // Владельцем базы, без tenant-контекста: разгребатель работает за все
    // заведения сразу, а каждое решение принимается внутри своего forTenant.
    const receipts = await this.prisma.ledgerEntry.findMany({
      where: {
        type: 'EARN',
        refType: 'receipt',
        actorType: { in: ['STAFF', 'OWNER'] },
        actorId: { not: null },
        createdAt: { gte: since },
        reward: { is: null },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        tenantId: true,
        guestId: true,
        membershipId: true,
        actorId: true,
        amount: true,
        basisAmount: true,
        createdAt: true,
      },
    })

    let decided = 0

    for (const receipt of receipts) {
      const written = await this.decide(receipt, now)
      decided += written ? 1 : 0
    }

    const vested = await this.vestSecondVisits(now)
    const cancelled = await this.cancelReversed(since)

    return { decided, vested, cancelled }
  }

  /** Разобрать один чек: заплатить или записать отказ с причиной. */
  private async decide(receipt: ReceiptRow, now: Date): Promise<boolean> {
    const staffId = receipt.actorId

    if (staffId === null) {
      return false
    }

    try {
      return await this.prisma.forTenant(receipt.tenantId, async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { id: receipt.tenantId },
          select: { settings: true, timezone: true },
        })
        const config = parseProgramConfig(tenant?.settings ?? {})

        const facts = await this.facts(tx, receipt, staffId, tenant?.timezone ?? 'UTC', now)
        const decision = decideStaffReward(config.staffReward, facts)

        // Выключенная доплата — не отказ по чеку, а отсутствие правила: строки
        // не пишем, иначе включение доплаты завтра не тронуло бы вчерашние чеки.
        if (!decision.paid && decision.reason === 'Доплата выключена в настройках') {
          return false
        }

        await tx.staffReward.create({
          data: {
            tenantId: receipt.tenantId,
            staffId,
            ledgerEntryId: receipt.id,
            membershipId: receipt.membershipId,
            basis: config.staffReward.basis,
            amount: decision.paid ? decision.amount : 0,
            state: decision.paid
              ? vestsImmediately(config.staffReward)
                ? 'VESTED'
                : 'PENDING'
              : 'CANCELLED',
            reason: decision.paid ? null : decision.reason,
            vestedAt: decision.paid && vestsImmediately(config.staffReward) ? now : null,
          },
        })

        return true
      })
    } catch (error) {
      // UNIQUE на чеке значит, что параллельный проход успел раньше, — это не
      // ошибка. Всё остальное ошибка, и молчать о ней нельзя: разгребатель,
      // который «работает», но ничего не пишет, ищется потом часами.
      const message = error instanceof Error ? error.message : 'неизвестно'
      const duplicate = message.includes('Unique constraint')

      if (duplicate) {
        this.logger.debug(`Награда по чеку ${receipt.id} уже записана`)
      } else {
        this.logger.warn(`Награда по чеку ${receipt.id} не записана: ${message}`)
      }

      return false
    }
  }

  /** Факты о чеке, от которых зависит решение. */
  private async facts(
    tx: Prisma.TransactionClient,
    receipt: ReceiptRow,
    staffId: string,
    timezone: string,
    now: Date,
  ): Promise<Parameters<typeof decideStaffReward>[1]> {
    const [earlierReceipts, guest, staff, rewardsToday] = await Promise.all([
      // Новый гость — тот, у кого этот чек первый неотменённый в заведении.
      tx.ledgerEntry.count({
        where: {
          tenantId: receipt.tenantId,
          membershipId: receipt.membershipId,
          type: 'EARN',
          refType: 'receipt',
          createdAt: { lt: receipt.createdAt },
        },
      }),
      tx.guest.findFirst({ where: { id: receipt.guestId }, select: { phoneE164: true } }),
      tx.staff.findFirst({
        where: { id: staffId, tenantId: receipt.tenantId },
        select: { phoneE164: true },
      }),
      // Смена — сутки заведения: отдельного учёта смен у нас нет, а сутки
      // считаются так же, как во всех отчётах.
      tx.staffReward.count({
        where: {
          tenantId: receipt.tenantId,
          staffId,
          state: { in: ['PENDING', 'VESTED'] },
          createdAt: { gte: startOfVenueDay(now, timezone) },
        },
      }),
    ])

    const guestPhone = guest?.phoneE164 ?? null
    const staffPhone = staff?.phoneE164 ?? null

    return {
      pointsEarned: receipt.amount,
      basisAmount: receipt.basisAmount,
      isNewGuest: earlierReceipts === 0,
      selfLinked: guestPhone !== null && staffPhone !== null && guestPhone === staffPhone,
      rewardsThisShift: rewardsToday,
    }
  }

  /**
   * Дозревание: гость пришёл второй раз — значит кассир привёл человека,
   * а не оформил прохожего.
   */
  private async vestSecondVisits(now: Date): Promise<number> {
    const pending = await this.prisma.staffReward.findMany({
      where: { state: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, tenantId: true, membershipId: true, createdAt: true },
    })

    let vested = 0

    for (const reward of pending) {
      const ripe = await this.prisma.forTenant(reward.tenantId, async (tx) => {
        const later = await tx.ledgerEntry.count({
          where: {
            tenantId: reward.tenantId,
            membershipId: reward.membershipId,
            type: 'EARN',
            refType: 'receipt',
            createdAt: { gt: reward.createdAt },
          },
        })

        if (later === 0) {
          return false
        }

        await tx.staffReward.updateMany({
          where: { id: reward.id, tenantId: reward.tenantId, state: 'PENDING' },
          data: { state: 'VESTED', vestedAt: now },
        })

        return true
      })

      vested += ripe ? 1 : 0
    }

    return vested
  }

  /** Отменённый чек снимает награду: платить за операцию, которой нет, нельзя. */
  private async cancelReversed(since: Date): Promise<number> {
    const rewards = await this.prisma.staffReward.findMany({
      where: {
        state: { in: ['PENDING', 'VESTED'] },
        createdAt: { gte: new Date(since.getTime() - DAY_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, tenantId: true, ledgerEntryId: true },
    })

    let cancelled = 0

    for (const reward of rewards) {
      const dropped = await this.prisma.forTenant(reward.tenantId, async (tx) => {
        const reversal = await tx.ledgerEntry.count({
          where: { tenantId: reward.tenantId, reversalOfId: reward.ledgerEntryId },
        })

        if (reversal === 0) {
          return false
        }

        await tx.staffReward.updateMany({
          where: { id: reward.id, tenantId: reward.tenantId, state: { in: ['PENDING', 'VESTED'] } },
          data: { state: 'CANCELLED', reason: 'Чек отменён', vestedAt: null },
        })

        return true
      })

      cancelled += dropped ? 1 : 0
    }

    if (cancelled > 0) {
      this.logger.log(`Снято наград по отменённым чекам: ${String(cancelled)}`)
    }

    return cancelled
  }
}

/** Начало суток заведения — как в отчётах: по его часовому поясу, а не по UTC. */
const startOfVenueDay = (now: Date, timezone: string): Date => {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

  // Полночь этого дня в зоне заведения: строим через смещение, которое даёт
  // сам Intl, — вручную часовые пояса не считаем никогда.
  const guess = new Date(`${local}T00:00:00Z`)
  const offset =
    guess.getTime() - new Date(guess.toLocaleString('en-US', { timeZone: timezone })).getTime()

  return new Date(guess.getTime() + offset)
}
