import { useState } from 'react'
import type { ReactElement } from 'react'
import { VenueBotInvite } from '@positive/contracts'

import { useT } from '../../../shared/i18n/i18n-context'
import { useSession } from '../../../shared/session/session-context'

/**
 * «Получать сообщения от заведения» на карте гостя. docs/02, раздел 2.14.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ КНОПКА, А НЕ АВТОМАТИКА. Telegram не даёт боту писать
 * первым: связать чат может только сам гость, нажав «Запустить» у бота кафе.
 * Сделать это за него нельзя — можно лишь дать ссылку.
 *
 * ССЫЛКА БЕРЁТСЯ ПО НАЖАТИЮ, А НЕ ЗАРАНЕЕ. В ней одноразовый код, живущий час:
 * выданный при открытии карты, он протух бы к моменту, когда гость до него
 * дошёл.
 *
 * У ЗАВЕДЕНИЯ БЕЗ СВОЕГО БОТА КНОПКИ НЕТ. Сервер отвечает «нет бота», и мы
 * молча убираем блок: предлагать подключиться к тому, чего нет, — обман.
 */
export function VenueBotInviteButton({ tenantId }: { tenantId: string }): ReactElement | null {
  const t = useT()
  const { authPost } = useSession()
  const [state, setState] = useState<'idle' | 'loading' | 'hidden'>('idle')

  if (state === 'hidden') {
    return null
  }

  const open = (): void => {
    setState('loading')

    const run = async (): Promise<void> => {
      try {
        const invite = await authPost(
          `/guest/venues/${encodeURIComponent(tenantId)}/bot/invite`,
          {},
          VenueBotInvite,
        )

        // Открываем в той же вкладке: Telegram перехватит ссылку и откроет
        // приложение, а всплывающее окно браузер на телефоне может и закрыть.
        window.location.href = invite.url
      } catch {
        // Своего бота у заведения нет — блок просто исчезает.
        setState('hidden')
      }
    }

    void run()
  }

  return (
    <button className="venue__botLink" disabled={state === 'loading'} type="button" onClick={open}>
      {t(state === 'loading' ? 'venueBot.opening' : 'venueBot.connect')}
    </button>
  )
}
