import { useState } from 'react'
import type { ReactElement } from 'react'
import type { IntegrationStatus } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatDate } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useIntegration, useRevealSecret, useRotateSecret } from '../integration-hooks'

/**
 * Блок «Касса» на экране настроек. docs/02, раздел 5.16.
 *
 * ЭКРАН ДЛЯ РАЗБОРА, А НЕ ДЛЯ НАСТРОЙКИ: подключение заводит касса, а владелец
 * приходит сюда с одним вопросом — «почему чеки не приходят». Поэтому здесь
 * счётчики принятого за неделю и застрявшего, а не поля ввода.
 *
 * КЛЮЧ ЗАМАСКИРОВАН, ПОКА НЕ ПОПРОСЯТ. Хвоста хватает, чтобы сверить с тем,
 * что введено в кассе; полный показывается по кнопке и уходит в историю.
 */
function Rows({ status }: { status: IntegrationStatus }): ReactElement {
  const t = useT()

  return (
    <dl className="broadcast-stats">
      <div className="broadcast-stats__item">
        <dt className="broadcast-stats__label">{t('integration.received')}</dt>
        <dd className="broadcast-stats__value">{status.receivedWeek}</dd>
      </div>
      <div className="broadcast-stats__item">
        <dt className="broadcast-stats__label">{t('integration.pending')}</dt>
        <dd className="broadcast-stats__value">{status.pending}</dd>
      </div>
      <div className="broadcast-stats__item">
        <dt className="broadcast-stats__label">{t('integration.failed')}</dt>
        <dd className="broadcast-stats__value">{status.failed}</dd>
      </div>
    </dl>
  )
}

export function IntegrationSettingsSection(): ReactElement {
  const t = useT()
  const integration = useIntegration()
  const reveal = useRevealSecret()
  const rotate = useRotateSecret()
  const [reason, setReason] = useState('')
  const [rotating, setRotating] = useState(false)

  return (
    <section className="panel" aria-labelledby="integration-title">
      <h2 className="panel__title" id="integration-title">
        {t('integration.title')}
      </h2>
      <p className="field__hint">{t('integration.hint')}</p>

      {integration.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : integration.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{integration.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void integration.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : !integration.data.connected ? (
        <p className="state__hint">{t('integration.none')}</p>
      ) : (
        <>
          <p className="field__hint">
            {fill(t('integration.connected'), {
              merchant: integration.data.posMerchantId ?? '—',
              date:
                integration.data.linkedAt === null ? '—' : formatDate(integration.data.linkedAt),
            })}
          </p>

          <div className="field">
            <span className="field__label">{t('integration.inbound')}</span>
            <code className="integration__code">
              {integration.data.inboundUrl === ''
                ? t('integration.inbound.unset')
                : integration.data.inboundUrl}
            </code>
            <p className="field__hint">{t('integration.inbound.hint')}</p>
          </div>

          <div className="field">
            <span className="field__label">{t('integration.secret')}</span>
            <code className="integration__code">
              {reveal.data?.secret ?? rotate.data?.secret ?? integration.data.secretMasked ?? '—'}
            </code>
            <p className="field__hint">{t('integration.secret.hint')}</p>
            {reveal.data === undefined && rotate.data === undefined ? (
              <button
                className="button"
                disabled={reveal.isPending}
                type="button"
                onClick={() => {
                  reveal.mutate()
                }}
              >
                {t('integration.secret.show')}
              </button>
            ) : null}
          </div>

          <Rows status={integration.data} />

          <p className="field__hint">
            {integration.data.lastEventAt === null
              ? t('integration.never')
              : fill(t('integration.last'), { date: formatDate(integration.data.lastEventAt) })}
          </p>

          {rotating ? (
            <div className="field">
              <label className="field__label" htmlFor="integration-reason">
                {t('integration.rotate.reason')}
              </label>
              <input
                className="field__input"
                id="integration-reason"
                maxLength={300}
                type="text"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                }}
              />
              <p className="field__hint">{t('integration.rotate.warning')}</p>
              {rotate.isError ? (
                <p className="state__hint state__hint--error" role="alert">
                  {rotate.error.message}
                </p>
              ) : null}
              <div className="panel__actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setRotating(false)
                    setReason('')
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="button button--primary"
                  disabled={reason.trim().length < 8 || rotate.isPending}
                  type="button"
                  onClick={() => {
                    rotate.mutate(
                      { reason: reason.trim() },
                      {
                        onSuccess: () => {
                          setRotating(false)
                          setReason('')
                        },
                      },
                    )
                  }}
                >
                  {t('integration.rotate.confirm')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button"
              type="button"
              onClick={() => {
                setRotating(true)
              }}
            >
              {t('integration.rotate')}
            </button>
          )}
        </>
      )}
    </section>
  )
}
