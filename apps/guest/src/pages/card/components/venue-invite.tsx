import { useState } from 'react'
import type { ReactElement } from 'react'
import type { WalletMembership } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/baht'
import { useT } from '../../../shared/i18n/i18n-context'
import { useReferral } from '../hooks'

/**
 * «Пригласить друга» у заведения в кошельке. docs/02, раздел 2.5 · docs/11, У6.
 *
 * КНОПКА — ТОЛЬКО ТАМ, ГДЕ ПРИГЛАШЕНИЕ ЧТО-ТО ПРИНЕСЁТ: заведение включило награду,
 * и гость не в группе сравнения. Это решает сервер (`inviteReward`), а не экран.
 *
 * ПОДЕЛИТЬСЯ — СИСТЕМНЫМ ОКНОМ ТЕЛЕФОНА, где оно есть: гость отправит ссылку
 * в тот мессенджер, где его друзья. Нет окна — ссылка копируется.
 */

/** Подписи процента по кругам: друг, его друзья, третий круг. */
const LEVEL_KEYS = ['invite.level.1', 'invite.level.2', 'invite.level.3'] as const

/** Проценты — как деньги: локаль одна, чтобы «0,5 %» не прыгало от языка. */
const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

const inviteLink = (tenantId: string, code: string): string =>
  `${window.location.origin}/?venue=${encodeURIComponent(tenantId)}&ref=${encodeURIComponent(code)}`

export function VenueInvite({ membership }: { membership: WalletMembership }): ReactElement | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const referral = useReferral(membership.tenantId, open)

  if (membership.inviteReward === null) {
    return null
  }

  if (!open) {
    return (
      <button
        className="venue__inviteOpen"
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('invite.open')}
      </button>
    )
  }

  const ready =
    referral.isSuccess && referral.data.enabled && referral.data.code !== null
      ? { ...referral.data, code: referral.data.code }
      : null
  const link = ready === null ? null : inviteLink(membership.tenantId, ready.code)
  const canShare = 'share' in navigator

  const share = async (): Promise<void> => {
    if (link === null) {
      return
    }

    if (canShare) {
      try {
        await navigator.share({
          title: membership.brandName,
          text: t('invite.shareText').replace('{venue}', membership.brandName),
          url: link,
        })
      } catch {
        // Гость закрыл окно — это не ошибка.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const inputId = `invite-link-${membership.tenantId}`

  return (
    <div className="venue__invite">
      {referral.isPending ? (
        <p className="venue__inviteHint" role="status">
          {t('invite.loading')}
        </p>
      ) : referral.isError ? (
        <p className="venue__inviteHint venue__inviteHint--error" role="alert">
          {t('invite.error')}{' '}
          <button
            className="venue__inviteLink"
            type="button"
            onClick={() => {
              void referral.refetch()
            }}
          >
            {t('invite.retry')}
          </button>
        </p>
      ) : ready === null || link === null ? (
        <p className="venue__inviteHint">{t('invite.off')}</p>
      ) : (
        <>
          {ready.reward > 0 ? (
            <p className="venue__inviteHint">
              {t('invite.reward').replace('{amount}', formatBaht(ready.reward))}
            </p>
          ) : null}
          {/* Процент с покупок друзей — по кругам; нулевой круг не упоминаем. */}
          {ready.levels.map((pct, index) =>
            pct > 0 ? (
              <p className="venue__inviteHint" key={LEVEL_KEYS[index] ?? index}>
                {t(LEVEL_KEYS[index] ?? 'invite.level.1').replace('{pct}', PERCENT.format(pct))}
              </p>
            ) : null,
          )}
          <label className="venue__inviteLabel" htmlFor={inputId}>
            {t('invite.link')}
          </label>
          <input
            id={inputId}
            className="venue__inviteUrl"
            type="text"
            readOnly
            value={link}
            onFocus={(event) => {
              event.target.select()
            }}
          />
          <p className="venue__inviteCode">{t('invite.code').replace('{code}', ready.code)}</p>
          <div className="venue__inviteActions">
            <button
              className="venue__inviteShare"
              type="button"
              onClick={() => {
                void share()
              }}
            >
              {canShare ? t('invite.share') : t('invite.copy')}
            </button>
            {copied ? (
              <span className="venue__inviteHint" role="status">
                {t('invite.copied')}
              </span>
            ) : null}
          </div>
          <p className="venue__inviteHint">
            {ready.reward > 0
              ? t('invite.stats')
                  .replace('{invited}', String(ready.invited))
                  .replace('{rewarded}', String(ready.rewarded))
                  .replace('{limit}', String(ready.limit))
              : t('invite.statsInvited').replace('{invited}', String(ready.invited))}
          </p>
        </>
      )}
      <button
        className="venue__inviteLink"
        type="button"
        onClick={() => {
          setOpen(false)
        }}
      >
        {t('invite.close')}
      </button>
    </div>
  )
}
