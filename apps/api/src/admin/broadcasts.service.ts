import { Injectable } from '@nestjs/common'
import { BROADCAST_FATIGUE_DAYS, BROADCAST_FATIGUE_LIMIT } from '@positive/contracts'
import type {
  AdminBroadcast,
  AdminBroadcastsList,
  AdminBroadcastsQuery,
  BroadcastAudience,
  BroadcastPreview,
  BroadcastPreviewInput,
  CreateBroadcastInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { GuestAudienceService } from './guest-audience.service'

/**
 * Рассылки заведения. docs/02, раздел 5.4 · docs/03, раздел 5.
 *
 * АУДИТОРИЯ ФИКСИРУЕТСЯ ПРИ СОЗДАНИИ. Список получателей пишется в базу сразу,
 * и отправка идёт по нему, а не по фильтрам: иначе «нашли 759» и «ушло 743»
 * расходились бы каждый раз, когда за минуту между показом и отправкой гость
 * сменил статус или перестал спать.
 *
 * УСТАЛОСТЬ СЧИТАЕТСЯ ПО ФАКТУ ОТПРАВКИ, а не по числу рассылок: гость, попавший
 * в пять аудиторий, но получивший четыре сообщения, — это четыре сообщения.
 * Пропущенные по усталости строки в счёт не идут, иначе пропуск наказывал бы
 * гостя второй раз.
 *
 * ОТПРАВЛЯЕТ НЕ ЭТОТ СЕРВИС, А РАЗГРЕБАТЕЛЬ (broadcast-send.service.ts): запрос
 * владельца не должен ждать тысячу обращений к Telegram.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Два канала связи, и достаточно любого: связанный Telegram ИЛИ уведомления
 * в приложении. Недостижим тот, у кого нет ни того, ни другого.
 */
const TELEGRAM = 'TELEGRAM' as const

interface Reach {
  /** Участия, подходящие под фильтры. */
  readonly memberships: ReadonlyArray<{ id: string; guestId: string }>
  /** Кому есть куда слать. */
  readonly reachable: ReadonlySet<string>
  /** Кто уже получил свои четыре сообщения за окно. */
  readonly tired: ReadonlySet<string>
}

@Injectable()
export class BroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly audience: GuestAudienceService,
  ) {}

  /** Сколько нашлось и сколько из них реально получит сообщение. */
  async preview(input: BroadcastPreviewInput): Promise<BroadcastPreview> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const reach = await this.reach(tx, tenantId, input.audience)

      return countReach(reach)
    })
  }

  async create(input: CreateBroadcastInput): Promise<AdminBroadcast> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    return this.createFor(tenantId, actorId, (role ?? 'OWNER') as AuditActorType, input)
  }

  /**
   * То же создание, но с явным заведением — для того, у кого нет запроса
   * владельца за спиной: автоматических сценариев (automation-run.service.ts).
   *
   * Один путь создания на всех: снимок аудитории, ограничение усталости и учёт
   * доставки должны работать одинаково, кто бы ни нажал «отправить».
   */
  async createFor(
    tenantId: string,
    actorId: string | null,
    actorType: AuditActorType,
    input: CreateBroadcastInput,
  ): Promise<AdminBroadcast> {
    // Прошедшее время означает «сейчас»: владелец нажал «отправить», а не «ждать».
    const sendAt = input.sendAt === undefined ? new Date() : new Date(input.sendAt)

    const row = await this.prisma.forTenant(tenantId, async (tx) => {
      const reach = await this.reach(tx, tenantId, input.audience)

      const broadcast = await tx.broadcast.create({
        data: {
          tenantId,
          title: input.title,
          text: input.text,
          audience: input.audience,
          sendAt,
          createdBy: actorId,
        },
        select: { id: true },
      })

      if (reach.memberships.length > 0) {
        await tx.broadcastRecipient.createMany({
          data: reach.memberships.map((membership) => ({
            tenantId,
            broadcastId: broadcast.id,
            guestId: membership.guestId,
            delivery: reach.tired.has(membership.guestId)
              ? ('SKIPPED_FATIGUE' as const)
              : reach.reachable.has(membership.guestId)
                ? ('PENDING' as const)
                : ('SKIPPED_NO_CHANNEL' as const),
          })),
          skipDuplicates: true,
        })
      }

      return this.readOne(tx, tenantId, broadcast.id)
    })

    await this.audit.write({
      action: 'BROADCAST_CREATED',
      actorType,
      actorId,
      tenantId,
      entityType: 'Broadcast',
      entityId: row.id,
      newValue: { title: row.title, total: row.total, sendAt: row.sendAt },
    })

    return row
  }

  async list(query: AdminBroadcastsQuery): Promise<AdminBroadcastsList> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.broadcast.findMany({
          where: { tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: query.offset,
          take: query.limit,
          select: { id: true },
        }),
        tx.broadcast.count({ where: { tenantId } }),
      ])

      const items = await Promise.all(rows.map((row) => this.readOne(tx, tenantId, row.id)))

      return { total, items }
    })
  }

  /**
   * Кто попадает под фильтры, кому есть куда слать и кто устал.
   *
   * Отдельные запросы вместо одного: «есть ли Telegram», «есть ли устройство
   * с уведомлениями» и «сколько получил за месяц» живут в разных таблицах,
   * и склеивать их в один SQL значило бы написать то, что Prisma всё равно
   * разберёт обратно.
   */
  private async reach(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filters: BroadcastAudience,
  ): Promise<Reach> {
    const where = await this.audience.where(tx, tenantId, filters)

    const memberships = await tx.membership.findMany({
      where,
      select: { id: true, guestId: true },
    })

    if (memberships.length === 0) {
      return { memberships, reachable: new Set(), tired: new Set() }
    }

    const guestIds = memberships.map((membership) => membership.guestId)
    const since = new Date(Date.now() - BROADCAST_FATIGUE_DAYS * DAY_MS)

    const [identities, devices, recent] = await Promise.all([
      tx.guestIdentity.findMany({
        where: { guestId: { in: guestIds }, provider: TELEGRAM },
        select: { guestId: true },
      }),
      // Устройства с живой подпиской на уведомления: приложение на телефоне
      // тоже канал, и гость, поставивший карту, больше не «некуда слать».
      tx.pushSubscription.findMany({
        where: { guestId: { in: guestIds }, goneAt: null },
        select: { guestId: true },
        distinct: ['guestId'],
      }),
      tx.broadcastRecipient.groupBy({
        by: ['guestId'],
        where: {
          tenantId,
          guestId: { in: guestIds },
          delivery: 'SENT',
          sentAt: { gte: since },
        },
        _count: { _all: true },
      }),
    ])

    return {
      memberships,
      reachable: new Set([
        ...identities.map((identity) => identity.guestId),
        ...devices.map((device) => device.guestId),
      ]),
      tired: new Set(
        recent
          .filter((row) => row._count._all >= BROADCAST_FATIGUE_LIMIT)
          .map((row) => row.guestId),
      ),
    }
  }

  private async readOne(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<AdminBroadcast> {
    const row = await tx.broadcast.findFirstOrThrow({
      where: { id, tenantId },
      select: {
        id: true,
        title: true,
        text: true,
        audience: true,
        status: true,
        sendAt: true,
        createdAt: true,
        createdBy: true,
        finishedAt: true,
      },
    })

    const counts = await tx.broadcastRecipient.groupBy({
      by: ['delivery'],
      where: { tenantId, broadcastId: id },
      _count: { _all: true },
    })

    const of = (delivery: string): number =>
      counts.find((row) => row.delivery === delivery)?._count._all ?? 0

    const author =
      row.createdBy === null
        ? null
        : ((
            await tx.staff.findFirst({
              where: { id: row.createdBy, tenantId },
              select: { displayName: true },
            })
          )?.displayName ?? null)

    return {
      id: row.id,
      title: row.title,
      text: row.text,
      audience: (row.audience ?? {}) as AdminBroadcast['audience'],
      status: row.status,
      sendAt: row.sendAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      author,
      total: counts.reduce((sum, item) => sum + item._count._all, 0),
      sent: of('SENT'),
      failed: of('FAILED'),
      tired: of('SKIPPED_FATIGUE'),
      unreachable: of('SKIPPED_NO_CHANNEL'),
    }
  }
}

/** Разложить охват на четыре числа предпросмотра. */
const countReach = (reach: Reach): BroadcastPreview => {
  let tired = 0
  let unreachable = 0
  let willReceive = 0

  for (const membership of reach.memberships) {
    if (reach.tired.has(membership.guestId)) {
      tired += 1
    } else if (reach.reachable.has(membership.guestId)) {
      willReceive += 1
    } else {
      unreachable += 1
    }
  }

  return { found: reach.memberships.length, willReceive, tired, unreachable }
}
