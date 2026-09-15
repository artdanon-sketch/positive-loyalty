import { HumanCode } from '@positive/contracts'
import { z } from 'zod'

/**
 * Ссылка в заведение, открытая до входа. docs/02, разделы 2.5 и 2.6 · docs/11, У6 и У7.
 *
 * Два вида ссылок:
 * - приглашение друга — `/?venue={заведение}&ref={код}`;
 * - ссылка источника — `/?venue={заведение}&src={код}`: табличка на столе, Instagram.
 *
 * ССЫЛКУ ОТКРЫВАЮТ ДО ВХОДА. Переадресация на экран входа срезает адресную
 * строку, а вход через Telegram и вовсе уводит гостя в другое приложение. Поэтому
 * ссылка читается из адреса при запуске и лежит в localStorage, пока карта
 * не откроется и не примет её (pages/card/components/invite-claim.tsx).
 *
 * ПРИГЛАШЕНИЕ ДРУГА ВАЖНЕЕ ИСТОЧНИКА. Если в ссылке оба кода, берётся приглашение:
 * друг — конкретный человек, которому положены баллы, а табличка — лишь канал.
 *
 * Из адреса параметры убираются сразу: перезагрузка страницы не должна
 * отправлять ссылку второй раз, а скопированная из строки ссылка на карту —
 * тащить за собой чужой код.
 */

const STORAGE_KEY = 'positive.guest.invite'

const PendingInviteSchema = z
  .object({
    /** Запомненное до появления источников — приглашение друга. */
    kind: z.enum(['referral', 'channel']).default('referral'),
    tenantId: z.uuid(),
    code: HumanCode,
  })
  .strict()

export type PendingInvite = z.infer<typeof PendingInviteSchema>

export const captureInvite = (
  location: Location = window.location,
  history: History = window.history,
): void => {
  const params = new URLSearchParams(location.search)

  if (!params.has('venue') && !params.has('ref') && !params.has('src')) {
    return
  }

  const ref = params.get('ref')
  const invite = PendingInviteSchema.safeParse({
    kind: ref === null ? 'channel' : 'referral',
    tenantId: params.get('venue'),
    code: ref ?? params.get('src'),
  })

  // Битую ссылку не запоминаем: принять её нельзя, а объяснять гостю нечего.
  if (invite.success) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(invite.data))
    } catch {
      // Приватный режим: ссылка не переживёт вход, но и не уронит приложение.
    }
  }

  params.delete('venue')
  params.delete('ref')
  params.delete('src')
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
