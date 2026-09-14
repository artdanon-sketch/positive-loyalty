import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'

/**
 * Карточка доступа: код устройства и PIN нового сотрудника.
 *
 * Показывается ОДИН РАЗ, сразу после добавления. Её задача — чтобы владелец
 * тут же передал сотруднику две вещи, которые тот введёт на планшете. Поэтому
 * значения крупные и моноширинные: их диктуют вслух или показывают экраном,
 * и «0» не должен спутаться с «O».
 *
 * После «Готово» PIN не покажет больше никто и нигде — сервер хранит только
 * хеш. Об этом сказано прямо, чтобы владелец не закрыл карточку, рассчитывая
 * посмотреть PIN потом.
 */
export function AccessCard({
  name,
  deviceCode,
  pin,
  onDone,
}: {
  name: string
  deviceCode: string
  pin: string
  onDone: () => void
}): ReactElement {
  const t = useT()

  return (
    <section className="access-card" aria-labelledby="access-card-title" role="status">
      <h2 className="access-card__title" id="access-card-title">
        {t('team.access.title')} {name}
      </h2>

      <dl className="access-card__grid">
        <div>
          <dt>{t('team.access.device')}</dt>
          <dd className="access-card__value">{deviceCode}</dd>
        </div>
        <div>
          <dt>{t('team.access.pin')}</dt>
          <dd className="access-card__value">{pin}</dd>
        </div>
      </dl>

      <p className="access-card__hint">{t('team.access.howTo')}</p>
      <p className="access-card__warn">{t('team.access.hint')}</p>

      <div className="panel__actions">
        <button className="button button--primary" type="button" onClick={onDone}>
          {t('team.access.done')}
        </button>
      </div>
    </section>
  )
}
