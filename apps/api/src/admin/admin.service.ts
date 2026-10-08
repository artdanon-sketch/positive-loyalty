import { Injectable, NotFoundException } from '@nestjs/common'
import { offerTitle, ProgramConfig } from '@positive/contracts'
import type {
  AdminGuestCard,
  AdminGuestRow,
  AdminGuestsList,
  AdminLedgerEntry,
  AdminLedgerList,
  AdminMembership,
  AdminTimelineItem,
  AdminGuestsQuery,
  GuestExportInput,
  GuestSort,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { maskPhone } from '../common/pii/mask-phone'
import { AuditService } from '../core/audit.service'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../core/prisma.service'
import { REFERRAL_REWARD_KEY_PREFIX } from '../core/referral-shares'
import { needsReferrals, resolveTier } from '../core/tiers'
import { guestsCsv } from './guest-export'
import { GuestAudienceService } from './guest-audience.service'

/**
 * Сколько последних операций и сколько последних подарков идёт в карточку.
 * Спор у стойки — про последние визиты; полгода назад — это «Операции».
 */
const TIMELINE_LIMIT = 50

/**
 * Потолок выгрузки. База малого заведения — тысячи гостей; десятки тысяч строк
 * в одном файле — это уже не рассылка по сегменту, а слив базы целиком.
 */
const EXPORT_LIMIT = 10_000

/** Витринные поля гостя, которые нужны списку и выгрузке. */
const GUEST_ROW_INCLUDE = {
  guest: { select: { displayName: true, phoneE164: true, mode: true } },
} as const

/**
 * Порядок списка гостей. docs/02, раздел 5.2.
 *
 * По умолчанию — недавние сверху, спящие в конце: экран отвечает на вопрос «кто
 * был недавно». Остальное — рейтинг за всё время, как «Рейтинг клиентов» у UDS.
 * Последний ключ — id: без него равные по сумме гости менялись бы местами между
 * страницами, и один попадал бы на две страницы, а другой — ни на одну.
 */
const guestOrder = (sort: GuestSort | undefined): Prisma.MembershipOrderByWithRelationInput[] => {
  switch (sort) {
    case 'spent':
      return [{ spentTotal: 'desc' }, { visitsTotal: 'desc' }, { id: 'asc' }]
    case 'visits':
      return [{ visitsTotal: 'desc' }, { spentTotal: 'desc' }, { id: 'asc' }]
    case 'points':
      return [{ pointsBalance: 'desc' }, { id: 'asc' }]
    case 'recent':
    case undefined:
      return [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
  }
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /** Условие списка гостей — общее с рассылками (docs/02, раздел 5.4). */
    private readonly audience: GuestAudienceService,
  ) {}

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
   *
   * Фильтры складываются через «и» (docs/11, У4); поиск — один из них.
   */
  async listGuests(query: AdminGuestsQuery): Promise<AdminGuestsList> {
    const { tenantId, role } = TenantContext.getOrThrow()
    const showFullPhone = role === 'OWNER'
    const { limit, offset, ...filters } = query

    return this.prisma.forTenant(tenantId, async (tx) => {
      const where = await this.audience.where(tx, tenantId, filters)
      const [rows, total, tierNames] = await Promise.all([
        tx.membership.findMany({
          where,
          include: GUEST_ROW_INCLUDE,
          orderBy: guestOrder(filters.sort),
          take: limit,
          skip: offset,
        }),
        tx.membership.count({ where }),
        this.tierNames(tx, tenantId),
      ])

      const items: AdminGuestRow[] = rows.map((row) => {
        const tierName = row.tierId === null ? undefined : tierNames.get(row.tierId)

        return {
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
          source: row.source,
          firstVisitAt: row.firstVisitAt?.toISOString() ?? null,
          tier:
            row.tierId === null || tierName === undefined
              ? null
              : { id: row.tierId, name: tierName },
        }
      })

      return { items, total }
    })
  }

  /**
   * Выгрузка гостей в CSV. docs/02, раздел 5.2 · docs/11, У4.
   *
   * ТЕЛЕФОНЫ — МАСКОЙ ДАЖЕ ВЛАДЕЛЬЦУ: файл пересылают, и полный номер в нём —
   * это база, утекающая одним вложением. Причина пишется в аудит вместе
   * с фильтрами и числом строк: через месяц видно, кто, зачем и сколько выгрузил.
   *
   * Аудит — до ответа, и его сбой выгрузку не пропускает: база без следа
   * не уходит (writeOrThrow).
   */
  async exportGuests(input: GuestExportInput): Promise<string> {
    const { tenantId, actorId, requestId } = TenantContext.getOrThrow()
    const { rows, tierNames, timezone } = await this.prisma.forTenant(tenantId, async (tx) => {
      const where = await this.audience.where(tx, tenantId, input.filters)
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true },
      })

      return {
        rows: await tx.membership.findMany({
          where,
          include: GUEST_ROW_INCLUDE,
          // Файл — в том же порядке, что и экран, с которого его выгрузили.
          orderBy: guestOrder(input.filters.sort),
          take: EXPORT_LIMIT,
        }),
        tierNames: await this.tierNames(tx, tenantId),
        timezone: tenant?.timezone ?? 'Asia/Bangkok',
      }
    })

    await this.audit.writeOrThrow({
      action: 'DATABASE_EXPORTED',
      actorType: 'OWNER',
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      newValue: { filters: input.filters, rows: rows.length, locale: input.locale },
      reason: input.reason,
      requestId,
    })

    return guestsCsv(
      rows.map((row) => ({
        name: row.guest.displayName,
        phone: maskPhone(row.guest.phoneE164),
        mode: row.guest.mode,
        tier: row.tierId === null ? null : (tierNames.get(row.tierId) ?? null),
        source: row.source,
        points: row.pointsBalance,
        visits: row.visitsTotal,
        spent: row.spentTotal,
        since: row.firstVisitAt,
        lastVisit: row.lastVisitAt,
      })),
      { locale: input.locale, timezone },
    )
  }

  /** Названия статусов по id. Неразборчивые настройки список не роняют — статусов просто нет. */
  private async tierNames(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<Map<string, string>> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { settings: true },
    })
    const program = ProgramConfig.safeParse(tenant?.settings ?? {})

    return new Map(program.success ? program.data.tiers.map((tier) => [tier.id, tier.name]) : [])
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
        include: {
          guest: { select: { displayName: true, phoneE164: true, mode: true } },
          channel: { select: { id: true, name: true } },
        },
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

      // Статус — тем же расчётом, что у кассы: карточка не должна показывать
      // «Золото», пока касса считает по «Гостю». Неразборчивые настройки карточку
      // не роняют — она нужна поддержке как раз тогда, когда что-то сломано.
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })
      const program = ProgramConfig.safeParse(tenant?.settings ?? {})
      const tiers = program.success ? program.data.tiers : []
      const referrals = needsReferrals(tiers)
        ? await tx.membership.count({
            where: { tenantId, referredById: membership.id, visitsTotal: { gt: 0 } },
          })
        : 0
      const tier = resolveTier(tiers, {
        tierId: membership.tierId,
        tierManual: membership.tierManual,
        spentTotal: membership.spentTotal,
        visitsTotal: membership.visitsTotal,
        referrals,
      })

      const tags = await tx.tag.findMany({
        where: { tenantId, guestTags: { some: { membershipId: membership.id } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, color: true },
      })

      // Приглашения: кто привёл гостя, скольких привёл он и за скольких получил баллы.
      const [invitedBy, invited, rewarded] = await Promise.all([
        membership.referredById === null
          ? Promise.resolve(null)
          : tx.membership.findFirst({
              where: { id: membership.referredById, tenantId },
              select: { guestId: true, guest: { select: { displayName: true } } },
            }),
        tx.membership.count({ where: { tenantId, referredById: membership.id } }),
        tx.ledgerEntry.count({
          where: {
            tenantId,
            membershipId: membership.id,
            type: 'GRANT',
            refType: 'referral',
            idempotencyKey: { startsWith: REFERRAL_REWARD_KEY_PREFIX },
          },
        }),
      ])

      const referral = {
        invitedBy:
          invitedBy === null
            ? null
            : { guestId: invitedBy.guestId, displayName: invitedBy.guest.displayName },
        invited,
        rewarded,
      }

      return { membership, shown, entries, grants, reversals, staff, tier, tags, referral }
    })

    if (data === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    const { membership, shown, entries, grants, reversals, staff, tier, tags, referral } = data
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
      tier:
        tier === null
          ? null
          : {
              id: tier.id,
              name: tier.name,
              manual: membership.tierManual && membership.tierId === tier.id,
            },
      firstVisitAt: membership.firstVisitAt?.toISOString() ?? null,
      lastVisitAt: membership.lastVisitAt?.toISOString() ?? null,
      pointsBalance: membership.pointsBalance,
      visitsTotal: membership.visitsTotal,
      spentTotal: membership.spentTotal,
      note: membership.note,
      tags,
      referral,
      channel: membership.channel,
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
