import type { TranslationKey } from '../../shared/i18n'
import type { GuestSourceValue } from './filters'

/** Откуда гость пришёл — одними словами в таблице, фильтре и карточке. */
export const SOURCE_LABELS: Readonly<Record<GuestSourceValue, TranslationKey>> = {
  ORGANIC: 'guestCard.source.organic',
  CATALOG: 'guestCard.source.catalog',
  REFERRAL: 'guestCard.source.referral',
  STAFF: 'guestCard.source.staff',
  IMPORT: 'guestCard.source.import',
}
