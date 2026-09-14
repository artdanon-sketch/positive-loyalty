import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import type { OfflineQueueState } from '../use-offline-queue'
import { StuckSale } from './stuck-sale'

/**
 * Застрявшие чеки на этом планшете. docs/03, раздел 10 · docs/10, раздел 5.7.
 *
 * Раньше кассир видел только число «застряло: 2» — и ничего не мог с ним
 * сделать: чек, отказанный сервером, крутился в очереди вечно. Теперь у каждого
 * два действия: повторить, вписав номер чека, если дело в нём, или убрать.
 *
 * Убранный чек пропадает и у владельца: следующий снимок очереди его уже
 * не содержит (docs/02, раздел 3.6).
 */
export function StuckQueue({ queue }: { queue: OfflineQueueState }): ReactElement | null {
  const t = useT()

  if (queue.stuck.length === 0) {
    return null
  }

  return (
    <section className="pos__step pos__stuck" aria-labelledby="pos-stuck-title">
      <h2 className="panel__title" id="pos-stuck-title">
        {t('pos.stuckList.title')}
      </h2>
      <p className="pos__notice">{t('pos.stuckList.hint')}</p>
      <ul className="pos__stuck-list">
        {queue.stuck.map((sale) => (
          <StuckSale
            key={sale.receiptId}
            sale={sale}
            onRetry={queue.retry}
            onDiscard={queue.discard}
          />
        ))}
      </ul>
    </section>
  )
}
