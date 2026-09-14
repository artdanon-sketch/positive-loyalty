import { PartnershipLimits, PartnershipReward, PartnershipTrigger } from '@positive/contracts'
import type {
  PartnershipStatus,
  PartnershipTermStatus,
  PartnershipTermView,
} from '@positive/contracts'

import type { Prisma } from '../generated/prisma/client'

/**
 * Условия партнёрства глазами одной из сторон.
 *
 * «Мы даём» и «они дают» — относительно того, кто смотрит: одно и то же
 * условие студия видит как «ресторан дарит нашим гостям», а ресторан — как
 * «мы дарим гостям студии».
 *
 * Название вида продаж из триггера подставляется здесь: соглашаются
 * на «абонемент на месяц», а не на идентификатор. Чужое название база отдаёт
 * по политике партнёра (миграция 20260914120000).
 *
 * Условие, которое не читается схемой (записано в обход API), не показывается,
 * а не роняет карточку: одна битая строка не должна прятать всё партнёрство.
 */

const TERM_SELECT = {
  id: true,
  status: true,
  rewardTenantId: true,
  trigger: true,
  reward: true,
  validityDays: true,
  limits: true,
  proposedBy: true,
  acceptedAt: true,
  pausedBy: true,
} satisfies Prisma.PartnershipTermSelect

/** Сначала ждущие ответа, потом действующие, в конце — закрытые. */
const ORDER: Readonly<Record<PartnershipTermStatus, number>> = {
  PROPOSED: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ACCEPTED: 3,
  DRAFT: 4,
  ENDED: 5,
}

const ENGAGED: readonly PartnershipStatus[] = ['NEGOTIATING', 'ACTIVE', 'PAUSED']

interface StatsRow {
  termId: string
  issued: number
  redeemed: number
}

export const loadTermViews = async (
  tx: Prisma.TransactionClient,
  partnershipId: string,
  tenantId: string,
  partnershipStatus: PartnershipStatus,
): Promise<PartnershipTermView[]> => {
  const rows = await tx.partnershipTerm.findMany({
    where: { partnershipId },
    select: TERM_SELECT,
    orderBy: [{ id: 'asc' }],
  })

  const readable = rows.flatMap((row) => {
    const trigger = PartnershipTrigger.safeParse(row.trigger)
    const reward = PartnershipReward.safeParse(row.reward)
    const limits = PartnershipLimits.safeParse(row.limits)

    return trigger.success && reward.success && limits.success
      ? [{ row, trigger: trigger.data, reward: reward.data, limits: limits.data }]
      : []
  })

  if (readable.length === 0) {
    return []
  }

  const kindIds = readable.flatMap(({ trigger }) =>
    trigger.type === 'ON_SALE_KIND' ? [trigger.saleKindId] : [],
  )

  const kinds =
    kindIds.length === 0
      ? []
      : await tx.saleKind.findMany({
          where: { id: { in: kindIds } },
          select: { id: true, name: true },
        })

  const stats = await tx.$queryRaw<StatsRow[]>`
    SELECT * FROM partnership_term_stats(${partnershipId})
  `

  const names = new Map(kinds.map((kind) => [kind.id, kind.name]))
  const counts = new Map(stats.map((stat) => [stat.termId, stat]))
  const engaged = ENGAGED.includes(partnershipStatus)

  return readable
    .map(({ row, trigger, reward, limits }): PartnershipTermView => {
      const ours = row.proposedBy === tenantId
      const pausedByUs = row.status === 'PAUSED' && row.pausedBy === tenantId

      return {
        id: row.id,
        direction: row.rewardTenantId === tenantId ? 'WE_GIVE' : 'THEY_GIVE',
        status: row.status,
        trigger,
        reward,
        validityDays: row.validityDays,
        limits,
        saleKindName:
          trigger.type === 'ON_SALE_KIND' ? (names.get(trigger.saleKindId) ?? null) : null,
        proposedByUs: ours,
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        pausedByUs,
        grantsIssued: counts.get(row.id)?.issued ?? 0,
        grantsRedeemed: counts.get(row.id)?.redeemed ?? 0,
        actions: {
          // Своё условие принимает другая сторона: предложив, мы уже согласились.
          accept: engaged && row.status === 'PROPOSED' && !ours,
          // Отклонить чужое или отозвать своё — одно действие.
          reject: engaged && row.status === 'PROPOSED',
          pause: engaged && row.status === 'ACTIVE',
          resume: engaged && pausedByUs,
        },
      }
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status])
}
