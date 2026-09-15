import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { Channel } from '@positive/contracts'

import { useAuth } from '../../../shared/auth/auth-context'
import { GUEST_URL } from '../../../shared/config/env'
import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { useChannels, useCreateChannel, useUpdateChannel } from '../channel-hooks'

/**
 * Блок «Источники трафика» в настройках. docs/03, раздел 9 · docs/11, У7.
 *
 * У КАЖДОГО ИСТОЧНИКА — ГОТОВАЯ ССЫЛКА. Владелец не собирает её руками: копирует
 * одной кнопкой и печатает QR-кодом на табличке или ставит в профиль Instagram.
 * Код в ссылке выдаёт сервер.
 *
 * ВЫКЛЮЧИТЬ, А НЕ УДАЛИТЬ. Выключенный источник остаётся в списке и в отчёте —
 * его прошлые гости никуда не делись, — но новых гостей по ссылке не принимает.
 */

const channelLink = (tenantId: string, code: string): string =>
  `${GUEST_URL}/?venue=${encodeURIComponent(tenantId)}&src=${encodeURIComponent(code)}`

export function ChannelSettingsSection(): ReactElement {
  const t = useT()
  const tenantId = useAuth().session?.subject.tenantId ?? ''
  const channels = useChannels()
  const create = useCreateChannel()
  const update = useUpdateChannel()

  const [name, setName] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (name.trim() === '' || create.isPending) {
      return
    }

    create.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          setName('')
        },
      },
    )
  }

  const copy = async (channel: Channel): Promise<void> => {
    try {
      await navigator.clipboard.writeText(channelLink(tenantId, channel.code))
      setCopied(channel.id)
    } catch {
      // Браузер не дал доступ к буферу — ссылка остаётся в поле, её можно выделить.
      setCopied(null)
    }
  }

  return (
    <section className="panel" aria-labelledby="channel-settings-title">
      <h2 className="panel__title" id="channel-settings-title">
        {t('channelSettings.title')}
      </h2>
      <p className="field__hint">{t('channelSettings.hint')}</p>

      {channels.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : channels.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {channels.error.message}
        </p>
      ) : channels.data.length === 0 ? (
        <p className="state__hint">{t('channelSettings.empty')}</p>
      ) : (
        <ul className="channel-list">
          {channels.data.map((channel) => {
            const inputId = `channel-link-${channel.id}`

            return (
              <li
                key={channel.id}
                className={
                  channel.isActive
                    ? 'channel-list__item'
                    : 'channel-list__item channel-list__item--off'
                }
              >
                <div className="channel-list__head">
                  <b>{channel.name}</b>
                  {channel.isActive ? null : (
                    <span className="chip chip--muted">{t('channelSettings.off')}</span>
                  )}
                  <button
                    className="button"
                    type="button"
                    disabled={update.isPending}
                    onClick={() => {
                      update.mutate({ id: channel.id, input: { isActive: !channel.isActive } })
                    }}
                  >
                    {t(channel.isActive ? 'channelSettings.disable' : 'channelSettings.enable')}
                  </button>
                </div>
                <label className="visually-hidden" htmlFor={inputId}>
                  {fill(t('channelSettings.link'), { name: channel.name })}
                </label>
                <div className="channel-list__link">
                  <input
                    id={inputId}
                    className="field__input"
                    type="text"
                    readOnly
                    value={channelLink(tenantId, channel.code)}
                    onFocus={(event) => {
                      event.target.select()
                    }}
                  />
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      void copy(channel)
                    }}
                  >
                    {t('channelSettings.copy')}
                  </button>
                  {copied === channel.id ? (
                    <span className="row-actions__ok" role="status">
                      {t('channelSettings.copied')}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form className="form-row" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="channel-settings-name">
            {t('channelSettings.name')}
          </label>
          <input
            id="channel-settings-name"
            className="field__input"
            type="text"
            maxLength={60}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        </div>
        <button
          className="button button--primary"
          type="submit"
          disabled={name.trim() === '' || create.isPending}
        >
          {t('channelSettings.create')}
        </button>
      </form>

      {create.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {create.error.message}
        </p>
      ) : null}
      {update.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {update.error.message}
        </p>
      ) : null}
    </section>
  )
}
