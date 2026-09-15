import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { TEMPLATE_IDS } from '../draft'
import type { TemplateId } from '../draft'
import { TEMPLATE_LABELS } from '../labels'

/**
 * Шаг 1 — шаблон. docs/03, раздел 4.
 *
 * Шаблон только заполняет форму: всё, что он подставил, владелец правит
 * на следующем шаге. Бейджей «у вас 14–17 пусто» нет — их пока не на чем
 * посчитать, а пустой бейдж лучше выдуманного.
 */
export function TemplatePicker({ onPick }: { onPick: (id: TemplateId) => void }): ReactElement {
  const t = useT()

  return (
    <div className="panel">
      <div className="template-grid">
        {TEMPLATE_IDS.map((id) => (
          <button
            key={id}
            className="template"
            type="button"
            onClick={() => {
              onPick(id)
            }}
          >
            <b className="template__name">{t(TEMPLATE_LABELS[id].name)}</b>
            <span className="template__caption">{t(TEMPLATE_LABELS[id].caption)}</span>
          </button>
        ))}
      </div>
      <p className="field__hint">{t('offerNew.later')}</p>
    </div>
  )
}
