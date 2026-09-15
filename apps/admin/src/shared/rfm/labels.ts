import type { RfmSegment } from '@positive/contracts'

import type { TranslationKey } from '../i18n'

/**
 * Названия RFM-сегментов и одна фраза «кто это». docs/02, раздел 5.10.
 * Общие для отчёта «RFM» и фильтра списка гостей: сегмент должен называться
 * одинаково там, где его видят, и там, куда по нему переходят.
 */

export const RFM_LABELS: Readonly<Record<RfmSegment, TranslationKey>> = {
  CHAMPIONS: 'rfm.CHAMPIONS',
  LOYAL: 'rfm.LOYAL',
  POTENTIAL: 'rfm.POTENTIAL',
  NEW: 'rfm.NEW',
  PROMISING: 'rfm.PROMISING',
  NEED_ATTENTION: 'rfm.NEED_ATTENTION',
  ABOUT_TO_SLEEP: 'rfm.ABOUT_TO_SLEEP',
  AT_RISK: 'rfm.AT_RISK',
  CANT_LOSE: 'rfm.CANT_LOSE',
  HIBERNATING: 'rfm.HIBERNATING',
}

export const RFM_HINTS: Readonly<Record<RfmSegment, TranslationKey>> = {
  CHAMPIONS: 'rfm.hint.CHAMPIONS',
  LOYAL: 'rfm.hint.LOYAL',
  POTENTIAL: 'rfm.hint.POTENTIAL',
  NEW: 'rfm.hint.NEW',
  PROMISING: 'rfm.hint.PROMISING',
  NEED_ATTENTION: 'rfm.hint.NEED_ATTENTION',
  ABOUT_TO_SLEEP: 'rfm.hint.ABOUT_TO_SLEEP',
  AT_RISK: 'rfm.hint.AT_RISK',
  CANT_LOSE: 'rfm.hint.CANT_LOSE',
  HIBERNATING: 'rfm.hint.HIBERNATING',
}
