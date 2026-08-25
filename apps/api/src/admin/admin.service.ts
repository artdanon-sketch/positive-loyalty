import { Injectable, NotFoundException } from '@nestjs/common'
import type { AdminLedgerEntry, AdminLedgerList, AdminMembership } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Чтение данных бэк-офиса.
 *
 * ЗДЕСЬ ЖИВЁТ РУБЕЖ 1 — и он выглядит не так, как в ТЗ.
 *
 * docs/01, раздел 5 предлагает расширение Prisma, которое само дописывает
 * `where: { tenantId }` во все запросы. Я его написал и убрал, по двум причинам.
 *
 * Первая: у `findUnique` в `where` допустимы ТОЛЬКО уникальные поля, дописать
 * туда `tenantId` нельзя — Prisma отвечает «Unknown argument». То есть самый
 * опасный случай, чтение по чужому прямому идентификатору, расширение не
 * закрывает в принципе. Пример в ТЗ этого не оговаривает.
 *
 * Вторая: сигнатура `$allOperations` не типизирована по модели, и расширение
 * получалось островом `any` посреди строгого кода — ровно там, где ошибка
 * означает утечку чужих данных.
 *
 * Поэтому рубеж 1 — явный фильтр в каждом запросе ниже. Его видно глазами,
 * его проверяет тест, и он не зависит от того, какую операцию Prisma позволит
 * перехватить в следующей мажорной версии. Настоящую границу держит рубеж 2 (RLS).
 *
 * КАЖДЫЙ метод ходит в базу через `prisma.forTenant()`. Это не стилистика:
 * `forTenant` открывает транзакцию и выставляет `app.tenant_id`, без которой
 * политики RLS не применяются, а роль приложения не видит вообще ничего.
 * Забыть обёртку не страшно — вместо утечки получится пустой список, то есть
 * ошибка проявится сразу и громко.
 *
 * `tenantId` берётся из `TenantContext`, куда его положил проверенный токен.
 * Ни один метод не принимает `tenantId` аргументом снаружи.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listLedger(limit: number, offset: number): Promise<AdminLedgerList> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.ledgerEntry.findMany({
          where: { tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        tx.ledgerEntry.count({ where: { tenantId } }),
      ])

      return { items: rows.map(toLedgerEntry), total }
    })
  }

  /**
   * Одна операция по прямому идентификатору.
   *
   * Чужая операция даёт 404, а НЕ 403 — требование docs/02, раздел 0:
   * «403 подтверждает существование объекта и является утечкой». По коду ответа
   * нельзя отличить «нет такой операции» от «есть, но не ваша».
   */
  async getLedgerEntry(id: string): Promise<AdminLedgerEntry> {
    const { tenantId } = TenantContext.getOrThrow()

    const row = await this.prisma.forTenant(tenantId, async (tx) =>
      // findFirst, а не findUnique: в where у findUnique допустимы только
      // уникальные поля, поэтому расширение не может дописать туда tenantId.
      // Здесь фильтр стоит явно, плюс RLS как второй рубеж.
      tx.ledgerEntry.findFirst({ where: { id, tenantId } }),
    )

    if (row === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Операция не найдена' },
      })
    }

    return toLedgerEntry(row)
  }

  async getMembership(id: string): Promise<AdminMembership> {
    const { tenantId } = TenantContext.getOrThrow()

    const row = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.findFirst({ where: { id, tenantId } }),
    )

    if (row === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Участие не найдено' },
      })
    }

    return {
      id: row.id,
      guestId: row.guestId,
      pointsBalance: row.pointsBalance,
      visitsTotal: row.visitsTotal,
      spentTotal: row.spentTotal,
      isControlGroup: row.isControlGroup,
      lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
    }
  }
}

interface LedgerRow {
  id: string
  type: string
  source: string
  amount: number
  balanceAfter: number
  basisAmount: number | null
  membershipId: string
  guestId: string
  refId: string | null
  reversalOfId: string | null
  createdAt: Date
}

const toLedgerEntry = (row: LedgerRow): AdminLedgerEntry => ({
  id: row.id,
  type: row.type as AdminLedgerEntry['type'],
  source: row.source as AdminLedgerEntry['source'],
  amount: row.amount,
  balanceAfter: row.balanceAfter,
  basisAmount: row.basisAmount,
  membershipId: row.membershipId,
  guestId: row.guestId,
  refId: row.refId,
  reversalOfId: row.reversalOfId,
  createdAt: row.createdAt.toISOString(),
})
