import { ENGINE_OFFER_TYPES, OfferSchedule } from '@positive/contracts'
import type { AdminOfferCard, OfferStatus } from '@positive/contracts'

/**
 * Жизнь акции: какой статус показать, какие кнопки дать, можно ли перейти.
 * docs/03, раздел 4 · docs/02, раздел 5.3 · docs/11, У2.
 *
 * ЧИСТЫЕ ФУНКЦИИ БЕЗ БАЗЫ. Границы — «ровно в момент начала», «пауза
 * завершённой», «запуск партнёрской» — проверяются юнит-тестами, а сервис
 * только читает строку и пишет решение.
 *
 * СТАТУС ПО ДАТАМ ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ. Запущенная акция с началом
 * завтра хранится как LIVE: касса её уже загружает и сама скажет «акция
 * начнётся 16.09». Владельцу она показывается запланированной, а после конца —
 * завершённой. Хранить эти переходы значило бы завести фоновое задание,
 * которое в полночь перекладывает статусы, — и акцию, которая не началась,
 * потому что задание упало.
 *
 * Границы — те же, что у движка кассы: в момент начала акция уже идёт,
 * в момент конца ещё идёт.
 */

export type OfferAction = 'publish' | 'pause' | 'end'

export interface OfferFacts {
  readonly status: OfferStatus
  readonly type: string
  readonly schedule: unknown
  /** Акция рождена партнёрством: её условия и судьба решаются там. */
  readonly isPartner: boolean
}

export type TransitionRefusal =
  'PARTNER_OFFER' | 'OFFER_NOT_SUPPORTED' | 'OFFER_EXPIRED' | 'INVALID_TRANSITION'

export type TransitionVerdict =
  | { readonly kind: 'CHANGE'; readonly to: OfferStatus }
  /** Акция уже в нужном статусе: повтор нажатия — не ошибка. */
  | { readonly kind: 'SAME' }
  | { readonly kind: 'REFUSE'; readonly code: TransitionRefusal; readonly message: string }

export const OFFER_EXPIRED_MESSAGE = 'Срок акции уже прошёл — запускать нечего'

const TARGET: Readonly<Record<OfferAction, OfferStatus>> = {
  publish: 'LIVE',
  pause: 'PAUSED',
  end: 'ENDED',
}

const refuse = (code: TransitionRefusal, message: string): TransitionVerdict => ({
  kind: 'REFUSE',
  code,
  message,
})

const bounds = (schedule: unknown): { startsAt: number | null; endsAt: number | null } => {
  const parsed = OfferSchedule.safeParse(schedule)

  if (!parsed.success) {
    return { startsAt: null, endsAt: null }
  }

  return {
    startsAt: parsed.data.startsAt === undefined ? null : Date.parse(parsed.data.startsAt),
    endsAt: parsed.data.endsAt === undefined ? null : Date.parse(parsed.data.endsAt),
  }
}

/** Статус, который видит владелец. Даты читаются только у запущенной акции. */
export const effectiveStatus = (
  offer: { readonly status: OfferStatus; readonly schedule: unknown },
  now: Date,
): OfferStatus => {
  if (offer.status !== 'LIVE') {
    return offer.status
  }

  const { startsAt, endsAt } = bounds(offer.schedule)

  if (endsAt !== null && now.getTime() > endsAt) {
    return 'ENDED'
  }

  if (startsAt !== null && now.getTime() < startsAt) {
    return 'SCHEDULED'
  }

  return 'LIVE'
}

export const decideTransition = (
  offer: OfferFacts,
  action: OfferAction,
  now: Date,
): TransitionVerdict => {
  // Железное правило 6 в интерфейсе: партнёрская акция живёт и умирает
  // вместе со своим условием, а не кнопкой в списке.
  if (offer.isPartner) {
    return refuse('PARTNER_OFFER', 'Условия партнёрской акции меняются только в партнёрстве')
  }

  const shown = effectiveStatus(offer, now)

  if (offer.status === TARGET[action] || (action === 'end' && shown === 'ENDED')) {
    return { kind: 'SAME' }
  }

  if (shown === 'ENDED') {
    return refuse('INVALID_TRANSITION', 'Акция завершена — её можно только посмотреть')
  }

  switch (action) {
    case 'publish':
      // Запустить акцию, которую касса не считает, — пообещать гостям то,
      // чего кассир не сможет дать.
      if (!(ENGINE_OFFER_TYPES as readonly string[]).includes(offer.type)) {
        return refuse(
          'OFFER_NOT_SUPPORTED',
          'Такую акцию касса пока не считает — запускать её рано',
        )
      }

      return effectiveStatus({ status: 'LIVE', schedule: offer.schedule }, now) === 'ENDED'
        ? refuse('OFFER_EXPIRED', OFFER_EXPIRED_MESSAGE)
        : { kind: 'CHANGE', to: 'LIVE' }
    case 'pause':
      return offer.status === 'DRAFT'
        ? refuse('INVALID_TRANSITION', 'Черновик ещё не запущен — ставить на паузу нечего')
        : { kind: 'CHANGE', to: 'PAUSED' }
    case 'end':
      return { kind: 'CHANGE', to: 'ENDED' }
  }
}

/**
 * Кнопки на карточке — ровно те шаги, которые сервер примет. Экран не угадывает:
 * кнопка, которая отвечает отказом, учит не доверять интерфейсу.
 */
export const offerActions = (
  offer: OfferFacts,
  role: string | null,
  now: Date,
): AdminOfferCard['actions'] => {
  // Менеджер смотрит акции, но не решает их судьбу: это галочка владельца (docs/05).
  if (role !== 'OWNER') {
    return { publish: false, pause: false, end: false }
  }

  const can = (action: OfferAction): boolean =>
    decideTransition(offer, action, now).kind === 'CHANGE'

  return { publish: can('publish'), pause: can('pause'), end: can('end') }
}
