import { useState } from 'react'
import type { ReactElement } from 'react'
import type { RedeemRewardResult } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { usePosRewards, useRedeemReward } from '../hooks'
import { isNetworkFailure } from '../offline-queue'

/**
 * Выдать гостю награду за баллы. docs/02, раздел 3.8.
 *
 * Гость видит в приложении «За баллы — покажите карту на кассе, списание проведёт
 * кассир», а у кассира не было ни списка, ни кнопки: награду, ради которой копили,
 * выдать было нечем.
 *
 * СПИСЫВАЕТСЯ СРАЗУ, ОТДЕЛЬНО ОТ ЧЕКА. Кофе за баллы — не покупка: денег нет,
 * начислять не с чего. Поэтому выдача не ждёт суммы чека и не мешает ей.
 *
 * `redemptionId` ЖИВЁТ ДО УСПЕХА. Связь оборвалась после списания — «Повторить»
 * уйдёт с тем же ключом, и сервер вернёт первый ответ вместо второго списания.
 *
 * БЕЗ СВЯЗИ НЕ ВЫДАЁМ: кассир должен знать сейчас, отдавать или нет, — как
 * и с промокодом.
 */
/** Ключ выдачи. randomUUID есть не во всех WebView планшетов — запасной путь на getRandomValues. */
const newRedemptionId = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function GuestRewards({
  membershipId,
  onSpent,
}: {
  membershipId: string
  onSpent: (balanceAfter: number) => void
}): ReactElement {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rewards = usePosRewards(membershipId, open)
  const redeem = useRedeemReward()
  const [attempt, setAttempt] = useState<{ itemId: string; redemptionId: string } | null>(null)
  const [done, setDone] = useState<RedeemRewardResult | null>(null)

  const give = (itemId: string): void => {
    // Тот же товар после сетевого сбоя — тот же ключ; другой товар — новый.
    const redemptionId =
      attempt !== null && attempt.itemId === itemId ? attempt.redemptionId : newRedemptionId()

    setAttempt({ itemId, redemptionId })
    setDone(null)
    redeem.mutate(
      { membershipId, itemId, redemptionId },
      {
        onSuccess: (result) => {
          setAttempt(null)
          setDone(result)
          onSpent(result.balanceAfter)
        },
        onError: (error) => {
          // Отказ сервера не изменится сам собой — ключ больше не нужен.
          if (!isNetworkFailure(error)) {
            setAttempt(null)
          }
        },
      },
    )
  }

  if (!open) {
    return (
      <button
        className="button button--ghost"
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('pos.rewards.open')}
      </button>
    )
  }

  return (
    <section className="pos__rewards" aria-labelledby="pos-rewards-title">
      <h2 className="panel__title" id="pos-rewards-title">
        {t('pos.rewards.title')}
      </h2>

      {done === null ? null : (
        <p className="pos__notice" role="status">
          {fill(t('pos.rewards.done'), {
            name: done.itemName,
            spent: formatBaht(done.pointsSpent),
            balance: formatBaht(done.balanceAfter),
          })}
        </p>
      )}

      {rewards.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : rewards.isError ? (
        <p className="pos__error" role="alert">
          {rewards.error.message}
        </p>
      ) : rewards.data.items.length === 0 ? (
        <p className="state__hint">{t('pos.rewards.empty')}</p>
      ) : (
        <ul className="pos__rewards-list">
          {rewards.data.items.map((item) => (
            <li className="pos__reward" key={item.id}>
              <span className="pos__reward-name">{item.name}</span>
              <span className="pos__reward-price">{formatBaht(item.pointsPrice)}</span>
              <button
                className="button"
                type="button"
                disabled={!item.affordable || redeem.isPending}
                onClick={() => {
                  give(item.id)
                }}
              >
                {item.affordable ? t('pos.rewards.give') : t('pos.rewards.notEnough')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {redeem.isError ? (
        <p className="pos__error" role="alert">
          {isNetworkFailure(redeem.error) ? t('pos.rewards.offline') : redeem.error.message}
        </p>
      ) : null}

      <button
        className="button button--ghost"
        type="button"
        onClick={() => {
          setOpen(false)
        }}
      >
        {t('pos.rewards.close')}
      </button>
    </section>
  )
}
