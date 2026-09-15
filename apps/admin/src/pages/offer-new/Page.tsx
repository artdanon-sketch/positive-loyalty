import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../../shared/auth/auth-context'
import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { Forecast } from './components/forecast'
import { GuestPreview } from './components/guest-preview'
import { OfferReview } from './components/offer-review'
import { RulesForm } from './components/rules-form'
import { TemplatePicker } from './components/template-picker'
import { draftOffer, templateDraft } from './draft'
import type { OfferDraft, TemplateId } from './draft'
import { useCreateOffer } from './hooks'
import { PROBLEM_LABELS, TEMPLATE_LABELS } from './labels'

/**
 * Конструктор акций. docs/03, раздел 4 · docs/11, У2.
 *
 * ОТДЕЛЬНЫЙ ЭКРАН, А НЕ МОДАЛЬНОЕ ОКНО — отступление от 03, записанное там же.
 * Форма, живое превью и прогноз в окне на телефоне не помещаются, а у экрана
 * есть свой адрес.
 *
 * Три шага: шаблон → условия с превью и прогнозом → проверка и запуск.
 * Черновик никто не увидит, пока владелец не запустит его с карточки.
 *
 * Только владелец. У менеджера здесь вежливый отказ; настоящий запрет стоит
 * на сервере.
 */

type Step = 'template' | 'rules' | 'review'

const STEPS: ReadonlyArray<{ readonly id: Step; readonly label: TranslationKey }> = [
  { id: 'template', label: 'offerNew.step.template' },
  { id: 'rules', label: 'offerNew.step.rules' },
  { id: 'review', label: 'offerNew.step.review' },
]

export function OfferNewPage(): ReactElement {
  const t = useT()
  const navigate = useNavigate()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const create = useCreateOffer()
  const [step, setStep] = useState<Step>('template')
  const [draft, setDraft] = useState<OfferDraft | null>(null)
  const [launching, setLaunching] = useState<'NOW' | 'DRAFT'>('NOW')

  const head = (
    <header className="page__head">
      <Link className="constructor__back" to="/offers">
        ← {t('offerNew.back')}
      </Link>
      <h1 className="page__title">{t('offerNew.title')}</h1>
      <p className="page__subtitle">{t('offerNew.subtitle')}</p>
    </header>
  )

  if (!isOwner) {
    return (
      <section className="page">
        {head}
        <div className="state">
          <p className="state__title">{t('offerNew.ownerOnly')}</p>
        </div>
      </section>
    )
  }

  const pick = (id: TemplateId): void => {
    const labels = TEMPLATE_LABELS[id]

    setDraft(
      templateDraft(id, {
        title: labels.title === null ? '' : t(labels.title),
        item: t('offerNew.template.WELCOME.item'),
      }),
    )
    setStep('rules')
  }

  const launch = (mode: 'NOW' | 'DRAFT'): void => {
    if (draft === null || create.isPending) {
      return
    }

    const checked = draftOffer(draft, mode)

    if (!checked.ok) {
      setStep('rules')
      return
    }

    setLaunching(mode)
    create.mutate(checked.offer, {
      onSuccess: () => {
        void navigate('/offers')
      },
    })
  }

  const current: Step = draft === null ? 'template' : step
  const checked = draft === null ? null : draftOffer(draft, 'NOW')

  return (
    <section className="page">
      {head}

      <ol className="steps" aria-label={t('offerNew.steps.label')}>
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className={item.id === current ? 'steps__item steps__item--on' : 'steps__item'}
            aria-current={item.id === current ? 'step' : undefined}
          >
            <span className="steps__n">{index + 1}</span>
            {t(item.label)}
          </li>
        ))}
      </ol>

      {draft === null || current === 'template' ? (
        <TemplatePicker onPick={pick} />
      ) : (
        <div className="constructor">
          <div className="constructor__main">
            {current === 'rules' ? (
              <>
                <RulesForm draft={draft} onChange={setDraft} />
                <Forecast draft={draft} />

                {checked !== null && !checked.ok ? (
                  <p className="field__hint field__hint--error" role="status">
                    {t(PROBLEM_LABELS[checked.problem])}
                  </p>
                ) : null}

                <div className="panel__actions">
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setStep('template')
                    }}
                  >
                    {t('offerNew.prev')}
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={checked === null || !checked.ok}
                    onClick={() => {
                      setStep('review')
                    }}
                  >
                    {t('offerNew.next')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <OfferReview draft={draft} />
                <p className="field__hint">{t('offerNew.review.hint')}</p>

                {create.isError ? (
                  <p className="state__hint state__hint--error" role="alert">
                    {create.error.message}
                  </p>
                ) : null}

                <div className="panel__actions">
                  <button
                    className="button"
                    type="button"
                    disabled={create.isPending}
                    onClick={() => {
                      setStep('rules')
                    }}
                  >
                    {t('offerNew.prev')}
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={create.isPending}
                    onClick={() => {
                      launch('DRAFT')
                    }}
                  >
                    {create.isPending && launching === 'DRAFT'
                      ? t('common.saving')
                      : t('offerNew.saveDraft')}
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={create.isPending}
                    onClick={() => {
                      launch('NOW')
                    }}
                  >
                    {create.isPending && launching === 'NOW'
                      ? t('common.saving')
                      : t('offerNew.launch')}
                  </button>
                </div>
              </>
            )}
          </div>

          <GuestPreview draft={draft} />
        </div>
      )}
    </section>
  )
}
