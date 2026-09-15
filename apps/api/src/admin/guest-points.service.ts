import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AdjustPointsInput, AdjustPointsResult } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import { IdempotencyKeyReusedError, InsufficientBalanceError } from '../core/ledger.errors'
import { LedgerService } from '../core/ledger.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Баллы вручную из карточки гостя. docs/02, раздел 5.2.3 · docs/11, У5.
 *
 * ТОЛЬКО ВЛАДЕЛЕЦ И ТОЛЬКО С ПРИЧИНОЙ. Ручная правка баланса — это деньги
 * заведения без чека: матрица прав (docs/05) отдаёт её владельцу, а причина
 * в аудите BALANCE_ADJUSTED — единственное, что через месяц объяснит строку
 * в журнале.
 *
 * ЧЕРЕЗ ЖУРНАЛ, А НЕ МИМО НЕГО (железное правило 1): операция ADJUST, баланс —
 * её снимок. Повтор нажатия с тем же ключом возвращает первую правку.
 *
 * В МИНУС НЕ УХОДИМ. Списать больше, чем есть, нельзя: ответ 409, а не тихое
 * обнуление — владелец должен узнать, что правка не прошла.
 */
@Injectable()
export class GuestPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async adjust(
    guestId: string,
    input: AdjustPointsInput,
    idempotencyKey: string,
  ): Promise<AdjustPointsResult> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()

    const membership = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.findFirst({ where: { guestId, tenantId }, select: { id: true } }),
    )

    if (membership === null) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Гость не найден' } })
    }

    try {
      const result = await this.ledger.adjust(
        {
          membershipId: membership.id,
          amount: input.amount,
          // Заведение в ключе: два заведения, случайно придумавшие один ключ,
          // иначе столкнулись бы на уникальности журнала.
          idempotencyKey: `adjust:${tenantId}:${idempotencyKey}`,
          source: 'STAFF_MANUAL',
          actorType: 'OWNER',
          ...(actorId === null ? {} : { actorId }),
        },
        { tenantId },
      )

      // Повтор ничего не изменил — и второй строки в аудите не оставляет.
      if (!result.replayed) {
        await this.audit.write({
          action: 'BALANCE_ADJUSTED',
          actorType: 'OWNER',
          actorId,
          tenantId,
          entityType: 'LedgerEntry',
          entityId: result.entry.id,
          oldValue: { balance: result.entry.balanceAfter - result.entry.amount },
          newValue: { balance: result.entry.balanceAfter, amount: result.entry.amount, guestId },
          reason: input.reason,
          requestId,
        })
      }

      return {
        entryId: result.entry.id,
        amount: result.entry.amount,
        balance: result.entry.balanceAfter,
        replayed: result.replayed,
      }
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        throw new ConflictException({
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'Списать больше, чем есть у гостя, нельзя',
          },
        })
      }

      if (error instanceof IdempotencyKeyReusedError) {
        throw new ConflictException({
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Этим ключом уже сделана другая правка',
          },
        })
      }

      throw error
    }
  }
}
