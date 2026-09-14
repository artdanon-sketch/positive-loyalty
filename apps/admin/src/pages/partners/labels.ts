import type { PartnershipStatus, PartnershipTermStatus, VenueVertical } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/** Подписи и тона статусов партнёрства — общие для списка, каталога и карточки. */

export const STATUS_LABELS: Readonly<Record<PartnershipStatus, TranslationKey>> = {
  PROPOSED: 'partners.status.PROPOSED',
  NEGOTIATING: 'partners.status.NEGOTIATING',
  ACTIVE: 'partners.status.ACTIVE',
  PAUSED: 'partners.status.PAUSED',
  ENDED: 'partners.status.ENDED',
  DECLINED: 'partners.status.DECLINED',
}

export const STATUS_TONES: Readonly<Record<PartnershipStatus, string>> = {
  PROPOSED: 'chip--good',
  NEGOTIATING: 'chip--neutral',
  ACTIVE: 'chip--good',
  PAUSED: 'chip--muted',
  ENDED: 'chip--muted',
  DECLINED: 'chip--bad',
}

export const TERM_STATUS_LABELS: Readonly<Record<PartnershipTermStatus, TranslationKey>> = {
  DRAFT: 'partner.term.status.DRAFT',
  PROPOSED: 'partner.term.status.PROPOSED',
  ACCEPTED: 'partner.term.status.ACCEPTED',
  ACTIVE: 'partner.term.status.ACTIVE',
  PAUSED: 'partner.term.status.PAUSED',
  ENDED: 'partner.term.status.ENDED',
}

export const TERM_STATUS_TONES: Readonly<Record<PartnershipTermStatus, string>> = {
  DRAFT: 'chip--muted',
  PROPOSED: 'chip--neutral',
  ACCEPTED: 'chip--neutral',
  ACTIVE: 'chip--good',
  PAUSED: 'chip--muted',
  ENDED: 'chip--muted',
}

export const VERTICAL_LABELS: Readonly<Record<VenueVertical, TranslationKey>> = {
  RESTAURANT: 'partners.vertical.RESTAURANT',
  SPA: 'partners.vertical.SPA',
  RENTAL: 'partners.vertical.RENTAL',
  RETAIL: 'partners.vertical.RETAIL',
  OTHER: 'partners.vertical.OTHER',
}

/** Разговор идёт или условия действуют — туда ведёт «Открыть», а не «Пригласить». */
export const ALIVE: readonly PartnershipStatus[] = ['PROPOSED', 'NEGOTIATING', 'ACTIVE', 'PAUSED']
