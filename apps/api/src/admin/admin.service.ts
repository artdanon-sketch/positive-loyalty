import { Injectable, NotFoundException } from '@nestjs/common'
import { offerTitle } from '@positive/contracts'
import type {
  AdminGuestCard,
  AdminGuestRow,
  AdminGuestsList,
  AdminLedgerEntry,
  AdminLedgerList,
  AdminMembership,
  AdminTimelineItem,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { maskPhone } from '../common/pii/mask-phone'
import { PrismaService } from '../core/prisma.service'
import { guestSearchWhere } from './guest-search'

/**
 * Сколько последних операций и сколько последних подарков идёт в карточку.
 * Спор у стойки — про последние визиты; полгода назад — это «Операции».
 */
const TIMELINE_LIMIT = 50

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

  /**
   * Список гостей заведения: участия, отсортированные по последнему визиту.
   *
   * Телефон маскируется ПО РОЛИ ИЗ ТОКЕНА: полный номер видит только владелец
   * (docs/05, раздел 3). Маскирование делает сервер — у клиента полного
   * значения просто нет, и «размаскировать» на фронте нечего.
   */
  async listGuests(limit: number, offset: number, q?: string): Promise<AdminGuestsList> {
    const { tenantId, role } = TenantContext.getOrThrow()
    const showFullPhone = role === 'OWNER'
    // tenantId стоит рядом с условием поиска, а не внутри него: поиск может
    // только сузить список своего заведения, но не расширить его.
    const where = { tenantId, ...guestSearchWhere(tenantId, q) }

    return this.prisma.forTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.membership.findMany({
          where,
          include: { guest: { select: { displayName: true, phoneE164: true, mode: true } } },
          // Спящие гости в конце: экран отвечает на вопрос «кто был недавно»,
          // а «кто давно не был» — это отдельный сегмент рассылок (Срез 4).
          orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: limit,
          skip: offset,
        }),
        tx.membership.count({ where }),
      ])

      const items: AdminGuestRow[] = rows.map((row) => ({
        membershipId: row.id,
        guestId: row.guestId,
        displayName: row.guest.displayName,
        phone: showFullPhone ? row.guest.phoneE164 : maskPhone(row.guest.phoneE164),
        mode: row.guest.mode,
        pointsBalance: row.pointsBalance,
        visitsTotal: row.visitsTotal,
        spentTotal: row.spentTotal,
        lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
        isControlGroup: row.isControlGroup,
      }))

      return { items, total }
    })
  }

  /**
   * Карточка гостя: цифры и история одной лентой.
   *
   * Адресуется ГОСТЕМ, а не участием (docs/02, раздел 5.2), но читается только
   * его участие в СВОЁМ заведении. Гость соседа даёт 404 — так же, как
   * несуществующий: по ответу нельзя узнать, что такой человек где-то есть.
   *
   * Подарки — только выданные этим заведением: чужие подарки гостя — чужая
   * программа, и их коды здесь делать нечего.
   */
  async guestCard(guestId: string, locale: string): Promise<AdminGuestCard> {
    const { tenantId, role } = TenantContext.getOrThrow()
    const now = new Date()

    const data = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { guestId, tenantId },
        include: { guest: { select: { displayName: true, phoneE164: true, mode: true } } },
      })

      if (membership === null) {
        return null
      }

      // На одну больше лимита: так без отдельного count видно, что показано не всё.
      const [entries, grants] = await Promise.all([
        tx.ledgerEntry.findMany({
          where: { tenantId, membershipId: membership.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: TIMELINE_LIMIT + 1,
          select: {
            id: true,
            type: true,
            source: true,
            amount: true,
            basisAmount: true,
            refType: true,
            refId: true,
            actorType: true,
            actorId: true,
            createdAt: true,
            occurredAt: true,
            saleKind: { select: { name: true } },
          },
        }),
        tx.offerGrant.findMany({
          where: { tenantId, guestId },
          orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
          take: TIMELINE_LIMIT + 1,
          select: {
            id: true,
            code: true,
            state: true,
            issuedAt: true,
            expiresAt: true,
            redeemedAt: true,
            redeemedReceiptId: true,
            offer: { select: { i18n: true } },
          },
        }),
      ])

      const shown = entries.slice(0, TIMELINE_LIMIT)
      const shownIds = shown.map((entry) => entry.id)
      const staffIds = [
        ...new Set(
          shown.flatMap((entry) =>
            entry.actorId !== null && (entry.actorType === 'STAFF' || entry.actorType === 'OWNER')
              ? [entry.actorId]
              : [],
          ),
        ),
      ]

      const [reversals, staff] = await Promise.all([
        shownIds.length === 0
          ? Promise.resolve([])
          : tx.ledgerEntry.findMany({
              where: { tenantId, reversalOfId: { in: shownIds } },
              select: { reversalOfId: true },
            }),
        staffIds.length === 0
          ? Promise.resolve([])
          : tx.staff.findMany({
              where: { tenantId, id: { in: staffIds } },
              select: { id: true, displayName: true },
            }),
      ])

      return { membership, shown, entries, grants, reversals, staff }
    })

    if (data === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    const { membership, shown, entries, grants, reversals, staff } = data
    const reversedIds = new Set(reversals.map((row) => row.reversalOfId))
    const staffNames = new Map(staff.map((person) => [person.id, person.displayName]))

    const operations: AdminTimelineItem[] = shown.map((entry) => ({
      kind: 'OPERATION',
      id: entry.id,
      at: (entry.occurredAt ?? entry.createdAt).toISOString(),
      type: entry.type,
      source: entry.source,
      amount: entry.amount,
      basisAmount: entry.basisAmount,
      receiptId: entry.refType === 'receipt' ? entry.refId : null,
      saleKind: entry.saleKind?.name ?? null,
      staffName: entry.actorId === null ? null : (staffNames.get(entry.actorId) ?? null),
      reversed: reversedIds.has(entry.id),
    }))

    const gifts: AdminTimelineItem[] = grants.slice(0, TIMELINE_LIMIT).map((grant) => ({
      kind: 'GIFT',
      grantId: grant.id,
      at: grant.issuedAt.toISOString(),
      title: offerTitle(grant.offer.i18n, locale),
      codeTail: grant.code.slice(-4),
      state: grant.state === 'ISSUED' && grant.expiresAt <= now ? 'EXPIRED' : grant.state,
      expiresAt: grant.expiresAt.toISOString(),
      redeemedAt: grant.redeemedAt?.toISOString() ?? null,
      redeemedReceiptId: grant.redeemedReceiptId,
    }))

    // ISO-строки одного формата сравниваются как строки — это и есть порядок во времени.
    const timeline = [...operations, ...gifts].sort((a, b) =>
      a.at === b.at ? 0 : a.at < b.at ? 1 : -1,
    )

    return {
      guestId,
      membershipId: membership.id,
      displayName: membership.guest.displayName,
      phone: role === 'OWNER' ? membership.guest.phoneE164 : maskPhone(membership.guest.phoneE164),
      mode: membership.guest.mode,
      source: membership.source,
      isControlGroup: membership.isControlGroup,
      firstVisitAt: membership.firstVisitAt?.toISOString() ?? null,
      lastVisitAt: membership.lastVisitAt?.toISOString() ?? null,
      pointsBalance: membership.pointsBalance,
      visitsTotal: membership.visitsTotal,
      spentTotal: membership.spentTotal,
      averageCheck:
        membership.visitsTotal > 0
          ? Math.floor(membership.spentTotal / membership.visitsTotal)
          : null,
      timeline,
      timelineLimit: TIMELINE_LIMIT,
      timelineTruncated: entries.length > TIMELINE_LIMIT || grants.length > TIMELINE_LIMIT,
    }
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
