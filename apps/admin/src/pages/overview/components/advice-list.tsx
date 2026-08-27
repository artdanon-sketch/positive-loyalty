import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardAdvice } from '@positive/contracts'

import { useT, useTPlural } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'

type Translate = (key: TranslationKey) => string
type TranslatePlural = (base: string, count: number) => string

/**
 * Блок «Что стоит сделать сегодня» (docs/03, раздел 2).
 *
 * Если советов нет — блок скрывается ЦЕЛИКОМ, а не показывает «всё хорошо».
 * Похвала вместо задачи обесценивает блок: владелец, увидев её дважды,
 * перестаёт сюда смотреть, и настоящий совет пройдёт мимо.
 *
 * Текст собирается здесь, а не на сервере: продукт четырёхъязычный, строки
 * живут в JSON. Сервер прислал повод и числа — подстановка и склонение
 * остаются задачей интерфейса.
 */
export function AdviceList({
  advice,
}: {
  advice: readonly DashboardAdvice[]
}): ReactElement | null {
  const t = useT()
  const tp = useTPlural()

  if (advice.length === 0) {
    return null
  }

  return (
    <section className="advice" aria-label={t('overview.advice.title')}>
      <h2 className="advice__title">{t('overview.advice.title')}</h2>
      <ul className="advice__list">
        {advice.map((item) => (
          <li className="advice-card" key={item.kind}>
            <p className="advice-card__text">{describe(item, t, tp)}</p>
            {/* Одно действие на карточку. Конструктор акций приедет со Срезом 3,
                поэтому советы ведут туда, где сегодня действительно можно
                что-то сделать, — вести в никуда хуже, чем вести ближе. */}
            <Link className="button button--ghost" to={actionOf(item)}>
              {actionLabel(item, t)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Ключи перечислены литералами, а не собраны шаблоном из `item.kind`.
 *
 * Это не многословность ради многословности: тип ключа выводится из ru.json,
 * поэтому забытый перевод ловит компилятор. Собранный шаблоном ключ такую
 * проверку обходит — и новый повод приехал бы на экран строкой
 * `overview.advice.NEW_THING.text` вместо текста.
 */
function describe(item: DashboardAdvice, t: Translate, tp: TranslatePlural): string {
  switch (item.kind) {
    case 'SLEEPING_GUESTS':
      // Через форму по числу, а не одной строкой: «21 гостей не заходили» —
      // это не опечатка, а ошибка языка, и владелец её замечает.
      return `${item.guests} ${tp('overview.advice.sleeping', item.guests)}`
    case 'QUIET_HOURS':
      return `${t('overview.advice.quiet.text')} ${hh(item.fromHour)} — ${hh(item.toHour + 1)}`
    case 'MANUAL_ENTRY':
      return `${t('overview.advice.manual.text')} ${item.sharePct}%`
  }
}

function actionLabel(item: DashboardAdvice, t: Translate): string {
  switch (item.kind) {
    case 'SLEEPING_GUESTS':
      return t('overview.advice.sleeping.action')
    case 'QUIET_HOURS':
      return t('overview.advice.quiet.action')
    case 'MANUAL_ENTRY':
      return t('overview.advice.manual.action')
  }
}

const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`

function actionOf(item: DashboardAdvice): string {
  return item.kind === 'MANUAL_ENTRY' ? '/operations' : '/guests'
}
