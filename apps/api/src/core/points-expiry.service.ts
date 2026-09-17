import { Injectable, Logger } from '@nestjs/common'
import { parseProgramConfig } from '@positive/contracts'

import { LedgerService } from './ledger.service'
import { expiringPoints, expiryCutoff, expiryKey } from './points-expiry'
import { PrismaService } from './prisma.service'

/**
 * Сгорание баллов. docs/02, раздел 5.6.8.
 *
 * ─── ПОЧЕМУ ЭТОГО НЕ БЫЛО ──────────────────────────────────────────────────
 *
 * Настройка `pointsExpireDays` лежала в конфигурации с самого начала и ничего
 * не делала. Заведение, поставившее «баллы сгорают через год», год спустя
 * обнаружило бы, что не сгорел ни один — а обязательство перед гостями всё
 * это время росло.
 *
 * ─── ЗА ОДИН ПРОХОД — ПАЧКА УЧАСТИЙ ────────────────────────────────────────
 *
 * Сгорание не горит: опоздать на час не страшно, а перебрать всю базу разом —
 * страшно. Берём тех, у кого есть что жечь, порциями.
 *
 * ─── ОДНО СГОРАНИЕ НА УЧАСТИЕ В СУТКИ ──────────────────────────────────────
 *
 * Ключ идемпотентности содержит дату: повторный проход в тот же день упрётся
 * в журнал, а не сожжёт второй раз.
 */

/** Сколько участий берём за проход. */
const BATCH = 50

export interface ExpiryTickResult {
  readonly burned: number
  readonly points: number
}

@Injectable()
export class PointsExpiryService {
  private readonly logger = new Logger(PointsExpiryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async tick(now: Date = new Date()): Promise<ExpiryTickResult> {
    // Владельцем базы: разгребатель работает за все заведения сразу.
    const tenants = await this.prisma.tenant.findMany({
      where: { settings: { path: ['pointsExpireDays'], not: 'null' } },
      select: { id: true, settings: true },
    })

    let burned = 0
    let points = 0

    for (const tenant of tenants) {
      const days = this.expiryDays(tenant.settings)

      if (days === null) {
        continue
      }

      const result = await this.forTenant(tenant.id, days, now)
      burned += result.burned
      points += result.points
    }

    return { burned, points }
  }

  private expiryDays(settings: unknown): number | null {
    try {
      return parseProgramConfig(settings).pointsExpireDays
    } catch {
      // Кривые настройки — забота экрана настроек, а не сгорания: молча
      // пропускаем заведение, а не роняем проход для всех остальных.
      return null
    }
  }

  private async forTenant(tenantId: string, days: number, now: Date): Promise<ExpiryTickResult> {
    const cutoff = expiryCutoff(now, days)

    const candidates = await this.prisma.membership.findMany({
      where: { tenantId, pointsBalance: { gt: 0 } },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, pointsBalance: true },
    })

    let burned = 0
    let points = 0

    for (const membership of candidates) {
      const amount = await this.amountFor(membership.id, membership.pointsBalance, cutoff)

      if (amount <= 0) {
        continue
      }

      try {
        await this.ledger.expire(
          { membershipId: membership.id, amount, idempotencyKey: expiryKey(membership.id, now) },
          { tenantId },
        )

        burned += 1
        points += amount
      } catch (error) {
        // Повтор в тот же день упирается в ключ идемпотентности — это норма.
        // Остальное стоит увидеть: сгорание трогает чужие деньги.
        this.logger.warn(
          `Сгорание на участии ${membership.id} не прошло: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    return { burned, points }
  }

  /** Сколько сгорает на этом участии: всё старое минус всё потраченное. */
  private async amountFor(membershipId: string, balance: number, cutoff: Date): Promise<number> {
    const [earned, spent] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: {
          membershipId,
          amount: { gt: 0 },
          // Дата операции, а не записи: досланная вечером смена принадлежит
          // своему дню и по нему же стареет.
          OR: [{ occurredAt: { lt: cutoff } }, { occurredAt: null, createdAt: { lt: cutoff } }],
        },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { membershipId, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
    ])

    return expiringPoints({
      earnedBeforeCutoff: earned._sum.amount ?? 0,
      spentTotal: Math.abs(spent._sum.amount ?? 0),
      balance,
    })
  }
}
