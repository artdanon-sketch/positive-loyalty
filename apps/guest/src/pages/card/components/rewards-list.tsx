import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n/i18n-context'
import { useGuestCatalog } from '../hooks'

/**
 * «Что можно взять за баллы» на карте гостя. docs/02, раздел 2.13.
 *
 * ГЛАВНОЕ — ЦЕЛЬ, А НЕ СПИСОК. Баллы без повода копить превращаются в цифру,
 * на которую гость не смотрит. Поэтому здесь только то, что можно получить,
 * и сразу видно, на что уже хватает.
 *
 * ПУСТОЙ КАТАЛОГ — БЛОКА НЕТ. Заведения, которое ничего не отдаёт за баллы,
 * это не касается, и пустой заголовок на карте ему не нужен.
 *
 * ЧТО ДАЛЬШЕ. Взять награду гость пока не может кнопкой: он показывает карту
 * кассиру, и списание проводит касса. Кнопка появится вместе с обменом баллов
 * на месте — и сразу с проверкой остатка на сервере.
 */
export function RewardsList(): ReactElement | null {
  const t = useT()
  const catalog = useGuestCatalog()

  if (catalog.isPending || catalog.isError || catalog.data.items.length === 0) {
    return null
  }

  return (
    <section className="rewards" aria-labelledby="rewards-title">
      <h2 className="card__sectionTitle" id="rewards-title">
        {t('rewards.title')}
      </h2>
      <p className="rewards__hint">{t('rewards.hint')}</p>

      <ul className="rewards__list">
        {catalog.data.items.map((item) => (
          <li
            className={item.affordable ? 'rewards__item' : 'rewards__item rewards__item--far'}
            key={item.id}
          >
            {item.imageUrl === null ? null : (
              <img alt="" className="rewards__image" loading="lazy" src={item.imageUrl} />
            )}
            <div className="rewards__main">
              <span className="rewards__name">{item.name}</span>
              <span className="rewards__venue">{item.venue}</span>
            </div>
            <span className="rewards__price">
              {item.pointsPrice}
              {item.affordable ? ' ★' : ' ★…'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
