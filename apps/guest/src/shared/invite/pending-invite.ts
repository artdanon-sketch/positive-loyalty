import { ReferralCode } from '@positive/contracts'
import { z } from 'zod'

/**
 * Приглашение друга, открытое по ссылке `/?venue={заведение}&ref={код}`.
 * docs/02, раздел 2.5 · docs/11, У6.
 *
 * ССЫЛКУ ОТКРЫВАЮТ ДО ВХОДА. Переадресация на экран входа срезает адресную
 * строку, а вход через Telegram и вовсе уводит гостя в другое приложение. Поэтому
 * приглашение читается из адреса при запуске и лежит в localStorage, пока карта
 * не откроется и не примет его (pages/card/components/invite-claim.tsx).
 *
 * Из адреса параметры убираются сразу: перезагрузка страницы не должна
 * отправлять приглашение второй раз, а скопированная из строки ссылка на карту —
 * тащить за собой чужой код.
 */

const STORAGE_KEY = 'positive.guest.invite'

const PendingInviteSchema = z
  .object({
    tenantId: z.uuid(),
    code: ReferralCode,
  })
  .strict()

export type PendingInvite = z.infer<typeof PendingInviteSchema>

export const captureInvite = (
  location: Location = window.location,
  history: History = window.history,
): void => {
  const params = new URLSearchParams(location.search)

  if (!params.has('venue') && !params.has('ref')) {
    return
  }

  const invite = PendingInviteSchema.safeParse({
    tenantId: params.get('venue'),
    code: params.get('ref'),
  })

  // Битую ссылку не запоминаем: принять её нельзя, а объяснять гостю нечего.
  if (invite.success) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(invite.data))
    } catch {
      // Приватный режим: приглашение не переживёт вход, но и не уронит приложение.
    }
  }

  params.delete('venue')
  params.delete('ref')
  const search = params.toString()

  history.replaceState(
    history.state,
    '',
    `${location.pathname}${search === '' ? '' : `?${search}`}${location.hash}`,
  )
}

export const readInvite = (): PendingInvite | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return null
    }

    const parsed = PendingInviteSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const clearInvite = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Нечего стирать — нечего и ронять.
  }
}
