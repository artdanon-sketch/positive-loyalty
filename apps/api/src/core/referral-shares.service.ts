import { Injectable, Logger } from '@nestjs/common'
import type { ProgramConfig } from '@positive/contracts'

import {
  AlreadyReversedError,
  IdempotencyKeyReusedError,
  InsufficientBalanceError,
} from './ledger.errors'
import { LedgerService } from './ledger.service'
import { PrismaService } from './prisma.service'
import { referralShareAmount, referralShareKey, referralSharePrefix } from './referral-shares'

/** Что нужно знать о покупателе, чтобы заплатить его пригласившим. */
export interface ShareBuyer {
  readonly id: string
  readonly referredById: string | null
  readonly isControlGroup: boolean
}

/**
 * Процент с покупок друзей — до трёх кругов вглубь. docs/02, раздел 5.6.2.
 *
 * Друг купил на 1 000 ฿ деньгами — пригласившему 5 %, его пригласившему 3 %,
 * третьему кругу 1 % (ставки — из настроек заведения). Как у UDS; по умолчанию
 * выключено (referral.ts).
 *
 * ─── ОТ ЧЕГО СЧИТАЕТСЯ ─────────────────────────────────────────────────────
 *
 * От уплаченного деньгами — той же базы, что у начисления и выручки в отчётах.
 * Процент с части, оплаченной баллами, был бы процентом с собственного долга.
 *
 * ─── КОМУ НЕ ПЛАТИМ ────────────────────────────────────────────────────────
 *
 * Контрольная группа не участвует ни с какой стороны: её покупки ничего не
 * приносят пригласившим, а пригласивший из группы ничего не получает — круг
 * пропускается, цепочка идёт дальше. Цепочка обрывается на первом, кого нет
 * в заведении, и на повторе: петля из двух гостей не платит сама себе.
 *
 * ─── ПОВТОР И ОТМЕНА ───────────────────────────────────────────────────────
 *
 * Ключ — друг, чек и круг (referral-shares.ts): повтор чека не платит дважды.
 * Отмена чека забирает проценты обратно. Если пригласивший уже потратил их,
 * журнал в минус не уходит (ledger.service.ts) — процент остаётся у него,
 * и это пишется в лог: политика «уводить в минус» принадлежит настройкам
 * программы, а не отмене чека.
 */
@Injectable()
export class ReferralSharesService {
  private readonly logger = new Logger(ReferralSharesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async give(
    tenantId: string,
    buyer: ShareBuyer,
    receiptId: string,
    basisAmount: number,
    config: ProgramConfig,
  ): Promise<void> {
    const { referral } = config

    if (
      !referral.enabled ||
      buyer.isControlGroup ||
      buyer.referredById === null ||
      basisAmount <= 0 ||
      !referral.levels.some((pct) => pct > 0)
    ) {
      return
    }

    const chain = await this.inviters(tenantId, buyer, referral.levels.length)

    for (const [index, inviter] of chain.entries()) {
      const amount = referralShareAmount(basisAmount, referral.levels[index] ?? 0)

      if (amount <= 0 || inviter.isControlGroup) {
        continue
      }

      try {
        await this.ledger.grant(
          {
            membershipId: inviter.id,
            amount,
            idempotencyKey: referralShareKey(buyer.id, receiptId, index + 1),
            refType: 'referral',
            refId: receiptId,
            source: 'SYSTEM',
            actorType: 'SYSTEM',
          },
          { tenantId },
        )
      } catch (error) {
        // Касса и вебхук одного чека, а ставка сменилась посередине: первый
        // процент уже записан, второй не нужен.
        if (error instanceof IdempotencyKeyReusedError) {
          continue
        }

        throw error
      }
    }
  }

  /** Отмена чека: забрать проценты этого чека у всех кругов. */
  async takeBack(tenantId: string, buyerMembershipId: string, receiptId: string): Promise<void> {
    const shares = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          tenantId,
          type: 'GRANT',
          refType: 'referral',
          refId: receiptId,
          idempotencyKey: { startsWith: referralSharePrefix(buyerMembershipId, receiptId) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
    )

    for (const share of shares) {
      try {
        await this.ledger.reverse(
          {
            entryId: share.id,
            idempotencyKey: `referral-share-void:${share.id}`,
            reason: 'RECEIPT_VOIDED',
            source: 'SYSTEM',
            actorType: 'SYSTEM',
          },
          { tenantId },
        )
      } catch (error) {
        if (error instanceof AlreadyReversedError) {
          continue
        }

        if (error instanceof InsufficientBalanceError) {
          this.logger.warn(
            `Процент за друга ${share.id} не забран при отмене чека: баллы уже потрачены`,
          )
          continue
        }

        throw error
      }
    }
  }

  /** Пригласившие по кругам, ближний первым. Обрывается на чужом и на петле. */
  private async inviters(
    tenantId: string,
    buyer: ShareBuyer,
    depth: number,
  ): Promise<Array<{ id: string; isControlGroup: boolean }>> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const chain: Array<{ id: string; isControlGroup: boolean }> = []
      const seen = new Set<string>([buyer.id])
      let next = buyer.referredById

      while (next !== null && chain.length < depth && !seen.has(next)) {
        const inviter = await tx.membership.findFirst({
          where: { id: next, tenantId },
          select: { id: true, isControlGroup: true, referredById: true },
        })

        if (inviter === null) {
          break
        }

        seen.add(inviter.id)
        chain.push({ id: inviter.id, isControlGroup: inviter.isControlGroup })
        next = inviter.referredById
      }

      return chain
    })
  }
}
