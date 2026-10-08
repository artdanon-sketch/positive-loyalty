import type { AutomationKind } from '@positive/contracts'

/**
 * Эпизод автосценария — то, что делает повторное письмо гостю законным.
 * docs/02, раздел 5.4.1.
 *
 * Условие сценария — состояние, а не событие: спящий гость остаётся спящим и
 * завтра. Без эпизода сценарий писал бы ему каждый день, пока не упрётся в
 * усталость, а подарок к письму выдавался бы ежедневно. Эпизод отвечает,
 * когда гость снова «новый» для сценария:
 *
 *   • «давно не заходил» — после следующего визита: гость пришёл, снова уснул —
 *     это новая история, и напомнить о себе снова уместно;
 *   • «вступил, но не купил» — никогда: вступают один раз;
 *   • «сумма покупок» — когда владелец поднял порог: благодарность за десять
 *     тысяч и за пятьдесят — разные благодарности.
 */
export const episodeOf = (
  kind: AutomationKind,
  threshold: number,
  lastVisitAt: Date | null,
): string => {
  switch (kind) {
    case 'SLEEPING':
      return `visit:${lastVisitAt === null ? 'never' : lastVisitAt.toISOString()}`
    case 'JOINED_NO_PURCHASE':
      return 'once'
    case 'SPENT_TOTAL':
      return `spent:${String(threshold)}`
  }
}
