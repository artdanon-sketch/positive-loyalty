import { useState } from 'react'
import type { ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectVenueBotInput, VenueBotStatus } from '@positive/contracts'

import { useAuth } from '../../../shared/auth/auth-context'
import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'

/**
 * Блок «Свой бот» на экране настроек. docs/02, раздел 5.18.
 *
 * ЧЕТЫРЕ ШАГА СЛОВАМИ, А НЕ ССЫЛКА НА ДОКУМЕНТАЦИЮ. Владелец кафе не знает,
 * кто такой @BotFather, и не должен узнавать это из чужого сайта: путь от
 * «хочу свой бот» до «ключ в поле» умещается в четыре строки, и они здесь.
 *
 * КЛЮЧ ОБРАТНО НЕ ПОКАЗЫВАЕТСЯ — только хвост. Потерявший его владелец берёт
 * новый у @BotFather: это его бот, а не наш.
 */

const BOT_KEY = ['admin', 'bot'] as const

export function BotSettingsSection(): ReactElement {
  const t = useT()
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const status = useQuery({
    queryKey: BOT_KEY,
    queryFn: () => authFetch<VenueBotStatus>('/admin/bot'),
  })

  const connect = useMutation({
    mutationFn: (input: ConnectVenueBotInput) =>
      authFetch<VenueBotStatus>('/admin/bot', {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      setToken('')
      void queryClient.invalidateQueries({ queryKey: BOT_KEY })
    },
  })

  const disconnect = useMutation({
    mutationFn: () => authFetch<VenueBotStatus>('/admin/bot', { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOT_KEY })
    },
  })

  return (
    <section className="panel" aria-labelledby="bot-title">
      <h2 className="panel__title" id="bot-title">
        {t('bot.title')}
      </h2>
      <p className="field__hint">{t('bot.hint')}</p>

      {status.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : status.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {status.error.message}
        </p>
      ) : status.data.connected ? (
        <>
          <p className="field__hint">
            {fill(t('bot.connected'), {
              username: status.data.username ?? '—',
              key: status.data.tokenMasked ?? '—',
            })}
          </p>
          <p className="field__hint">
            {fill(t('bot.subscribers'), { count: String(status.data.subscribers) })}
          </p>
          <div className="panel__actions">
            <button
              className="button"
              disabled={disconnect.isPending}
              type="button"
              onClick={() => {
                disconnect.mutate()
              }}
            >
              {t('bot.disconnect')}
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="bot-steps">
            <li>{t('bot.step.1')}</li>
            <li>{t('bot.step.2')}</li>
            <li>{t('bot.step.3')}</li>
            <li>{t('bot.step.4')}</li>
          </ol>

          <div className="field">
            <label className="field__label" htmlFor="bot-token">
              {t('bot.field.token')}
            </label>
            <input
              className="field__input"
              id="bot-token"
              placeholder="1234567890:AA..."
              type="text"
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
              }}
            />
            <p className="field__hint">{t('bot.field.tokenHint')}</p>
          </div>

          {connect.isError ? (
            <p className="state__hint state__hint--error" role="alert">
              {connect.error.message}
            </p>
          ) : null}

          <button
            className="button button--primary"
            disabled={token.trim().length < 20 || connect.isPending}
            type="button"
            onClick={() => {
              connect.mutate({ token: token.trim() })
            }}
          >
            {connect.isPending ? t('common.saving') : t('bot.connect')}
          </button>
        </>
      )}
    </section>
  )
}
