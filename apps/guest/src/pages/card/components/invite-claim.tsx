import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { ApiError } from '../../../shared/api/api-client'
import type { TranslationKey } from '../../../shared/i18n/dictionaries'
import { useT } from '../../../shared/i18n/i18n-context'
import { clearInvite, readInvite } from '../../../shared/invite/pending-invite'
import { useAcceptReferral } from '../hooks'

/**
 * Приглашение друга, открытое до входа. docs/02, раздел 2.5 · docs/11, У6.
 *
 * Принимается один раз, как только открылась карта: запомненное стирается сразу,
 * чтобы отказ («своя ссылка») не всплывал при каждом открытии. Ответ — одной
 * строкой над картой; по коду ошибки, а не по тексту сервера, потому что гостю
 * нужен совет, что делать, а не причина отказа.
 */

const ERRORS: Partial<Record<string, TranslationKey>> = {
  SELF_REFERRAL: 'invite.claim.self',
  INVITE_NOT_FOUND: 'invite.claim.notFound',
}

export function InviteClaim(): ReactElement | null {
  const t = useT()
  const [invite] = useState(readInvite)
  const [dismissed, setDismissed] = useState(false)
  // Strict Mode монтирует эффекты дважды; второй запрос ответил бы «уже гость»
  // и спрятал бы настоящий результат первого.
  const started = useRef(false)
  const { mutate, data, error, isPending, isIdle } = useAcceptReferral()

  useEffect(() => {
    if (invite === null || started.current) {
      return
    }

    started.current = true
    clearInvite()
    mutate(invite)
  }, [invite, mutate])

  if (invite === null || dismissed || isIdle) {
    return null
  }

  const failed = error !== null
  const text = isPending
    ? t('invite.claim.pending')
    : failed
      ? t((error instanceof ApiError ? ERRORS[error.code] : undefined) ?? 'invite.claim.failed')
      : data === undefined
        ? null
        : t(data.joined ? 'invite.claim.joined' : 'invite.claim.already').replace(
            '{venue}',
            data.brandName,
          )

  return (
    <section
      className={failed ? 'invite-claim invite-claim--error' : 'invite-claim'}
      role={failed ? 'alert' : 'status'}
      aria-label={t('invite.claim.label')}
    >
      <p className="invite-claim__text">{text}</p>
      {isPending ? null : (
        <button
          className="invite-claim__dismiss"
          type="button"
          onClick={() => {
            setDismissed(true)
          }}
        >
          {t('invite.claim.dismiss')}
        </button>
      )}
    </section>
  )
}
