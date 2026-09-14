import type { PlatformComplaintsRow } from '@positive/contracts'

import { SUSPEND_COMPLAINTS } from '../partnerships/invite-restriction'

/**
 * Жалобы на спам в приглашениях — для разбора владельцем платформы.
 * docs/07, раздел 6.2.
 *
 * СЧИТАЮТСЯ РАЗНЫЕ ЗАВЕДЕНИЯ, как и в самой приостановке: одно, пожаловавшееся
 * дважды, — одна жалоба. Иначе панель показывала бы «пять жалоб» там, где
 * приглашения не приостановлены, и разбор начинался бы с недоверия к цифре.
 */

export interface OpenStrike {
  readonly againstTenantId: string
  readonly againstBrandName: string
  readonly fromTenantId: string
  readonly fromBrandName: string
  readonly createdAt: Date
}

/** Причина живёт в блокировке, которую жалоба и поставила. */
export interface BlockReason {
  readonly blockerTenantId: string
  readonly blockedTenantId: string
  readonly reason: string | null
}

const pairKey = (from: string, against: string): string => `${from}:${against}`

/**
 * Сгруппировать жалобы по заведению, на которое жалуются.
 *
 * Порядок — по срочности: сначала приостановленные (они ждут разбора, чтобы
 * снова приглашать), затем по числу жалоб, затем по свежести.
 */
export const groupComplaints = (
  strikes: readonly OpenStrike[],
  reasons: readonly BlockReason[],
): PlatformComplaintsRow[] => {
  const reasonOf = new Map(
    reasons.map((row) => [pairKey(row.blockerTenantId, row.blockedTenantId), row.reason]),
  )
  const groups = new Map<string, { brandName: string; latest: Map<string, OpenStrike> }>()

  for (const strike of strikes) {
    const group = groups.get(strike.againstTenantId) ?? {
      brandName: strike.againstBrandName,
      latest: new Map<string, OpenStrike>(),
    }
    const known = group.latest.get(strike.fromTenantId)

    if (known === undefined || known.createdAt.getTime() < strike.createdAt.getTime()) {
      group.latest.set(strike.fromTenantId, strike)
    }

    groups.set(strike.againstTenantId, group)
  }

  return [...groups.entries()]
    .flatMap(([tenantId, group]) => {
      const complaints = [...group.latest.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((strike) => ({
          fromTenantId: strike.fromTenantId,
          fromBrandName: strike.fromBrandName,
          reason: reasonOf.get(pairKey(strike.fromTenantId, tenantId)) ?? null,
          createdAt: strike.createdAt.toISOString(),
        }))
      const last = complaints[0]

      return last === undefined
        ? []
        : [
            {
              tenantId,
              brandName: group.brandName,
              openComplaints: complaints.length,
              suspended: complaints.length >= SUSPEND_COMPLAINTS,
              lastComplaintAt: last.createdAt,
              complaints,
            },
          ]
    })
    .sort(
      (a, b) =>
        Number(b.suspended) - Number(a.suspended) ||
        b.openComplaints - a.openComplaints ||
        b.lastComplaintAt.localeCompare(a.lastComplaintAt),
    )
}
