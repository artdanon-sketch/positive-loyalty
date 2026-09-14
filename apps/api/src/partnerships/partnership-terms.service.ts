import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PartnershipLimits, PartnershipReward } from '@positive/contracts'
import type {
  PartnerSaleKinds,
  PartnershipDetail,
  PartnershipStatus,
  ProposeTermInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { PartnershipsService } from './partnerships.service'
import { partnerOfferTexts } from './term-texts'

/**
 * Условия партнёрства: предложить, принять, отклонить, приостановить.
 * docs/07, разделы 5 и 9 · железное правило 6.
 *
 * ─── ПРИНЯТОЕ УСЛОВИЕ РОЖДАЕТ АКЦИЮ ─────────────────────────────────────────
 *
 * Акция с видимостью PARTNER появляется у заведения, которое даёт подарок,
 * в момент принятия — не раньше: до согласия обеих сторон её быть не должно.
 * Дальше всё идёт через то, что уже работает: слушатель триггеров выдаёт
 * по акции промокоды, кошелёк их показывает, касса гасит. Отдельных
 * «партнёрских кодов» нет (железное правило 6).
 *
 * Повторное принятие второй акции не создаёт. Условие переводится
 * в «действует» условным обновлением «было предложено и без акции»,
 * в той же транзакции, что и создание акции: второе принятие, пришедшее
 * одновременно, находит условие уже действующим, откатывается — и его акция
 * исчезает вместе с ним.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ ─────────────────────────────────────────────────────────
 *
 * Правки действующего условия (docs/07, раздел 5, правило 4): «изменить» —
 * это предложить новое условие и приостановить старое. Отдельного
 * «заменить» пока нет.
 */

const ENGAGED: readonly PartnershipStatus[] = ['NEGOTIATING', 'ACTIVE', 'PAUSED']

/** Структурные сообщения чата текста не несут: экран рисует их по виду. */
const STRUCTURAL = { text: '', sourceLang: 'und', translations: {} } as const

type Tx = Prisma.TransactionClient

interface Side {
  id: string
  status: PartnershipStatus
  initiatorTenantId: string
  partnerTenantId: string
}

@Injectable()
export class PartnershipTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerships: PartnershipsService,
  ) {}

  /** Виды продаж обеих сторон — для конструктора условия «за абонемент». */
  async saleKinds(partnershipId: string): Promise<PartnerSaleKinds> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const partnership = await engaged(tx, tenantId, partnershipId)
      const partnerId = otherSide(partnership, tenantId)

      const kinds = await tx.saleKind.findMany({
        where: { tenantId: { in: [tenantId, partnerId] }, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, tenantId: true },
      })

      const option = (kind: { id: string; name: string }): { id: string; name: string } => ({
        id: kind.id,
        name: kind.name,
      })

      return {
        ours: kinds.filter((kind) => kind.tenantId === tenantId).map(option),
        theirs: kinds.filter((kind) => kind.tenantId === partnerId).map(option),
      }
    })
  }

  async propose(partnershipId: string, input: ProposeTermInput): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()

    await this.prisma.forTenant(tenantId, async (tx) => {
      const partnership = await engaged(tx, tenantId, partnershipId)
      const partnerId = otherSide(partnership, tenantId)

      const rewardTenantId = input.direction === 'WE_GIVE' ? tenantId : partnerId
      const triggerTenantId = input.direction === 'WE_GIVE' ? partnerId : tenantId

      // Вид продажи обязан принадлежать заведению, ГДЕ ПОКУПАЮТ, и быть включённым.
      // Внешнего ключа на него в условии нет, а проверка «строка существует»
      // здесь не годится: чужой вид соседа тоже существует.
      if (input.trigger.type === 'ON_SALE_KIND') {
        const kind = await tx.saleKind.findFirst({
          where: { id: input.trigger.saleKindId, tenantId: triggerTenantId, isActive: true },
          select: { id: true },
        })

        if (kind === null) {
          throw new BadRequestException({
            error: {
              code: 'SALE_KIND_NOT_FOUND',
              message: 'У заведения, где гость должен совершить покупку, такого вида продаж нет',
            },
          })
        }
      }

      const term = await tx.partnershipTerm.create({
        data: {
          partnershipId,
          triggerTenantId,
          rewardTenantId,
          trigger: input.trigger,
          reward: input.reward,
          validityDays: input.validityDays,
          limits: input.limits,
          status: 'PROPOSED',
          proposedBy: tenantId,
        },
        select: { id: true },
      })

      await tx.partnershipMessage.create({
        data: {
          partnershipId,
          fromTenantId: tenantId,
          toTenantId: partnerId,
          kind: 'TERM_PROPOSED',
          termId: term.id,
          ...STRUCTURAL,
        },
      })
    })

    return this.partnerships.detail(partnershipId)
  }

  async accept(partnershipId: string, termId: string): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    const term = await this.prisma.forTenant(tenantId, async (tx) => {
      const partnership = await engaged(tx, tenantId, partnershipId)
      const row = await findTerm(tx, partnershipId, termId)

      if (row.status !== 'PROPOSED') {
        throw termState('Условие уже не ждёт ответа')
      }

      if (row.proposedBy === tenantId) {
        throw new ForbiddenException({
          error: {
            code: 'NOT_COUNTERPARTY',
            message: 'Своё условие принимает другая сторона: предложив, вы уже согласились',
          },
        })
      }

      const reward = PartnershipReward.safeParse(row.reward)
      const limits = PartnershipLimits.safeParse(row.limits)

      if (!reward.success || !limits.success) {
        throw termState('Условие записано с ошибкой — его нужно предложить заново')
      }

      return {
        partnerId: otherSide(partnership, tenantId),
        rewardTenantId: row.rewardTenantId,
        triggerTenantId: row.triggerTenantId,
        reward: reward.data,
        limits: limits.data,
      }
    })

    // АКЦИЯ СОЗДАЁТСЯ ПОД ЗАВЕДЕНИЕМ, КОТОРОЕ ДАЁТ ПОДАРОК: она его, и политика
    // на акциях пустит запись только от его имени. Принимать при этом может
    // и вторая сторона — право проверено выше, под её собственным контекстом.
    await this.prisma.forTenant(term.rewardTenantId, async (tx) => {
      // ЗАМКИ ДО ПРОВЕРКИ — и в том же порядке, что у расторжения: сначала
      // партнёрство, потом условие, иначе два запроса поймали бы друг друга
      // во взаимной блокировке.
      //
      // Условного обновления без замка здесь мало. Два одновременных «принять»
      // оба прошли бы проверку выше и оба создали бы по акции, а условие
      // «ещё предложено», проверенное подзапросом, в Postgres при конкурентной
      // записи перепроверяется по старому снимку и пропустило бы обоих.
      // С замком второе ждёт первое и видит условие уже действующим.
      const [partnership] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM "Partnership"
        WHERE id = ${partnershipId}
        FOR UPDATE
      `
      const [locked] = await tx.$queryRaw<Array<{ status: string; offerId: string | null }>>`
        SELECT status::text AS status, "offerId" FROM "PartnershipTerm"
        WHERE id = ${termId} AND "partnershipId" = ${partnershipId}
        FOR UPDATE
      `

      if (
        partnership === undefined ||
        !(ENGAGED as readonly string[]).includes(partnership.status) ||
        locked === undefined ||
        locked.status !== 'PROPOSED' ||
        locked.offerId !== null
      ) {
        throw termState('Условие уже не ждёт ответа')
      }

      const [from] = await tx.$queryRaw<Array<{ brandName: string }>>`
        SELECT "brandName" FROM network_venues() WHERE id = ${term.triggerTenantId}
      `

      const offer = await tx.offer.create({
        data: {
          tenantId: term.rewardTenantId,
          type: 'NETWORK_VOUCHER',
          status: 'LIVE',
          visibility: 'PARTNER',
          audience: {},
          schedule: {},
          limits: { totalQty: term.limits.totalGrants, perGuestQty: term.limits.perGuest },
          reward: term.reward,
          i18n: partnerOfferTexts(term.reward, from?.brandName ?? null),
        },
        select: { id: true },
      })

      await tx.partnershipTerm.update({
        where: { id: termId },
        data: { status: 'ACTIVE', offerId: offer.id, acceptedBy: tenantId, acceptedAt: now },
      })

      await tx.partnership.updateMany({
        where: { id: partnershipId, status: 'NEGOTIATING' },
        data: { status: 'ACTIVE' },
      })
    })

    await this.prisma.forTenant(tenantId, async (tx) =>
      tx.partnershipMessage.create({
        data: {
          partnershipId,
          fromTenantId: tenantId,
          toTenantId: term.partnerId,
          kind: 'TERM_ACCEPTED',
          termId,
          ...STRUCTURAL,
        },
      }),
    )

    return this.partnerships.detail(partnershipId)
  }

  /** Отклонить чужое предложенное условие или отозвать своё. */
  async reject(
    partnershipId: string,
    termId: string,
    reason: string | undefined,
  ): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()

    await this.prisma.forTenant(tenantId, async (tx) => {
      const partnership = await engaged(tx, tenantId, partnershipId)
      await findTerm(tx, partnershipId, termId)

      const closed = await tx.partnershipTerm.updateMany({
        where: { id: termId, partnershipId, status: 'PROPOSED' },
        data: { status: 'ENDED' },
      })

      if (closed.count === 0) {
        throw termState('Условие уже не ждёт ответа')
      }

      await tx.partnershipMessage.create({
        data: {
          partnershipId,
          fromTenantId: tenantId,
          toTenantId: otherSide(partnership, tenantId),
          kind: 'TERM_REJECTED',
          termId,
          ...STRUCTURAL,
          text: reason ?? '',
        },
      })
    })

    return this.partnerships.detail(partnershipId)
  }

  /**
   * Приостановить действующее условие. Любая сторона, без объяснений.
   * Новые подарки перестают выдаваться, выданные действуют до своего срока.
   */
  async pause(partnershipId: string, termId: string): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await engaged(tx, tenantId, partnershipId)
      await findTerm(tx, partnershipId, termId)

      const paused = await tx.partnershipTerm.updateMany({
        where: { id: termId, partnershipId, status: 'ACTIVE' },
        data: { status: 'PAUSED', pausedBy: tenantId },
      })

      if (paused.count === 0) {
        throw termState('Приостановить можно только действующее условие')
      }
    })

    return this.partnerships.detail(partnershipId)
  }

  /** Снять паузу. Только тот, кто её поставил. */
  async resume(partnershipId: string, termId: string): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await engaged(tx, tenantId, partnershipId)
      const row = await findTerm(tx, partnershipId, termId)

      if (row.status !== 'PAUSED') {
        throw termState('Условие не стоит на паузе')
      }

      if (row.pausedBy !== tenantId) {
        throw new ForbiddenException({
          error: {
            code: 'NOT_PAUSER',
            message: 'Паузу поставила другая сторона — снять её может только она',
          },
        })
      }

      const resumed = await tx.partnershipTerm.updateMany({
        where: { id: termId, partnershipId, status: 'PAUSED', pausedBy: tenantId },
        data: { status: 'ACTIVE', pausedBy: null },
      })

      if (resumed.count === 0) {
        throw termState('Условие не стоит на паузе')
      }
    })

    return this.partnerships.detail(partnershipId)
  }
}

const otherSide = (row: Side, tenantId: string): string =>
  row.initiatorTenantId === tenantId ? row.partnerTenantId : row.initiatorTenantId

/** Партнёрство, в котором заведение — сторона и где уже можно обсуждать условия. */
const engaged = async (tx: Tx, tenantId: string, partnershipId: string): Promise<Side> => {
  const row = await tx.partnership.findFirst({
    where: {
      id: partnershipId,
      OR: [{ initiatorTenantId: tenantId }, { partnerTenantId: tenantId }],
    },
    select: { id: true, status: true, initiatorTenantId: true, partnerTenantId: true },
  })

  if (row === null) {
    throw new NotFoundException({
      error: { code: 'NOT_FOUND', message: 'Партнёрство не найдено' },
    })
  }

  if (!ENGAGED.includes(row.status)) {
    throw new ConflictException({
      error: {
        code: 'PARTNERSHIP_STATE',
        message: 'Условия обсуждают после принятия приглашения и до расторжения',
      },
    })
  }

  return row
}

const findTerm = async (
  tx: Tx,
  partnershipId: string,
  termId: string,
): Promise<{
  status: string
  proposedBy: string
  pausedBy: string | null
  rewardTenantId: string
  triggerTenantId: string
  reward: Prisma.JsonValue
  limits: Prisma.JsonValue
}> => {
  const row = await tx.partnershipTerm.findFirst({
    where: { id: termId, partnershipId },
    select: {
      status: true,
      proposedBy: true,
      pausedBy: true,
      rewardTenantId: true,
      triggerTenantId: true,
      reward: true,
      limits: true,
    },
  })

  if (row === null) {
    throw new NotFoundException({
      error: { code: 'TERM_NOT_FOUND', message: 'Условие не найдено' },
    })
  }

  return row
}

const termState = (message: string): ConflictException =>
  new ConflictException({ error: { code: 'TERM_STATE', message } })
