import { QRCodeSVG } from 'qrcode.react'
import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { usePosInvite } from '../hooks'
import { QueryFallback } from './query-fallback'

/**
 * Вкладка «Пригласить»: QR заведения, по которому гость записывается у стойки.
 * docs/02, раздел 3.9.
 *
 * НАЗВАНИЕ ИСТОЧНИКА — РЯДОМ С QR. Кассир видит, куда запишется гость: иначе
 * заведение однажды обнаружит, что все гости со стойки числятся пришедшими
 * из Instagram.
 *
 * ЦВЕТА QR — ПОСТОЯННЫЕ ТОКЕНЫ `--qr-paper` и `--qr-ink`, а не цвета темы:
 * сканеру нужен наибольший контраст, а тёмная тема дала бы серый на сером.
 * Код рисуется `currentColor` по прозрачному фону, цвета задаёт подложка
 * в styles.css — в компоненте не остаётся ни одного шестнадцатеричного значения.
 */
export function InviteTab(): ReactElement {
  const t = useT()
  const invite = usePosInvite()

  if (invite.data === undefined) {
    return <QueryFallback query={invite} />
  }

  const { url, source } = invite.data

  if (source === null) {
    return (
      <div className="state">
        <p className="state__title">{t('pos.invite.empty.title')}</p>
        <p className="state__hint">{t('pos.invite.empty.hint')}</p>
      </div>
    )
  }

  if (url === null) {
    return (
      <div className="state">
        <p className="state__title">{t('pos.invite.noUrl.title')}</p>
        <p className="state__hint">{t('pos.invite.noUrl.hint')}</p>
      </div>
    )
  }

  return (
    <div className="pos__step pos-invite">
      <p className="pos-invite__lead">{t('pos.invite.lead')}</p>

      <div className="pos-invite__qr">
        <QRCodeSVG
          value={url}
          size={240}
          level="M"
          bgColor="transparent"
          fgColor="currentColor"
          marginSize={2}
          role="img"
          aria-label={t('pos.invite.qr')}
        />
      </div>

      <dl className="pos__summary">
        <div className="pos__row">
          <dt>{t('pos.invite.source')}</dt>
          <dd>{source}</dd>
        </div>
      </dl>
      <p className="pos__hint">{t('pos.invite.sourceHint')}</p>
    </div>
  )
}
