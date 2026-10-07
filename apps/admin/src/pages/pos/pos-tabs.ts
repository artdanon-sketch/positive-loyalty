import type { PosConfig } from '@positive/contracts'

/**
 * Вкладки экрана кассы. docs/02, раздел 3.9.
 *
 * «Счёт» и «Профиль» есть всегда. «Пригласить» и «Историю» открывает владелец,
 * и касса не рисует вкладку, которой нет: вкладка, ведущая в отказ, хуже
 * отсутствующей. Сервер при этом проверяет сам — спрятать вкладку значит
 * сделать удобно, а не защитить.
 *
 * Флаг, которого нет в ответе (сервер старше экрана), значит «выключено»:
 * открыть вкладку, которую сервер не знает, — тот же отказ, только позже.
 */

export type PosTab = 'sale' | 'invite' | 'history' | 'profile'

export const posTabs = (config: Partial<PosConfig>): PosTab[] => [
  'sale',
  ...(config.allowInvite === true ? (['invite'] as const) : []),
  ...(config.showOwnHistory === true ? (['history'] as const) : []),
  'profile',
]
