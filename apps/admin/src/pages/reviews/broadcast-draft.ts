import { BROADCAST_TEXT_MAX, BROADCAST_TITLE_MAX } from '@positive/contracts'
import type { BroadcastAudience, BroadcastPreview } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/**
 * Черновик рассылки: что выбрано, что мешает отправить. docs/03, раздел 5.
 *
 * ГОТОВЫЕ СЕГМЕНТЫ, А НЕ КОНСТРУКТОР ФИЛЬТРОВ. Рассылка — редкое действие
 * владельца, и повторяет он один и тот же выбор: «всем», «спящим», «тем, кто
 * не покупал». Полный набор фильтров живёт в списке гостей, где ему и место.
 *
 * ПРИЧИНА ЗАПРЕТА ВАЖНЕЕ САМОГО ЗАПРЕТА. Серая кнопка без объяснения выглядит
 * как поломка, поэтому каждая помеха — это строка, которую видно рядом.
 */

export interface BroadcastDraft {
  readonly title: string
  readonly text: string
  readonly segment: AudienceSegment
}

export type AudienceSegment = 'all' | 'sleeping' | 'no-purchase' | 'tourists' | 'residents'

export const AUDIENCE_SEGMENTS: ReadonlyArray<{
  readonly id: AudienceSegment
  readonly label: TranslationKey
  readonly audience: BroadcastAudience
}> = [
  { id: 'all', label: 'broadcasts.segment.all', audience: {} },
  { id: 'sleeping', label: 'broadcasts.segment.sleeping', audience: { sleeping: 30 } },
  { id: 'no-purchase', label: 'broadcasts.segment.noPurchase', audience: { buyers: 'none' } },
  { id: 'tourists', label: 'broadcasts.segment.tourists', audience: { mode: 'TOURIST' } },
  { id: 'residents', label: 'broadcasts.segment.residents', audience: { mode: 'RESIDENT' } },
]

export const audienceOfSegment = (segment: AudienceSegment): BroadcastAudience =>
  AUDIENCE_SEGMENTS.find((item) => item.id === segment)?.audience ?? {}

export const emptyDraft = (): BroadcastDraft => ({ title: '', text: '', segment: 'all' })

/** Что мешает отправить. Пустой список — можно. */
export const draftIssues = (
  draft: BroadcastDraft,
  preview: BroadcastPreview | undefined,
): readonly TranslationKey[] => {
  const issues: TranslationKey[] = []

  if (draft.title.trim().length < 2) {
    issues.push('broadcasts.issue.title')
  }

  if (draft.text.trim().length < 2) {
    issues.push('broadcasts.issue.text')
  }

  if (draft.text.trim().length > BROADCAST_TEXT_MAX) {
    issues.push('broadcasts.issue.long')
  }

  if (draft.title.trim().length > BROADCAST_TITLE_MAX) {
    issues.push('broadcasts.issue.titleLong')
  }

  // Предпросмотр ещё не пришёл — это не помеха, а ожидание: кнопка ждёт молча.
  if (preview !== undefined && preview.willReceive === 0) {
    issues.push('broadcasts.issue.nobody')
  }

  return issues
}

/** Сколько знаков осталось. Отрицательное — перебор. */
export const charsLeft = (text: string): number => BROADCAST_TEXT_MAX - text.trim().length
