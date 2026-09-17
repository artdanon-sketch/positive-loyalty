import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ProgramSettings } from '@positive/contracts'

import { useT } from '../../../shared/i18n'
import { useSaveProgramSettings } from '../hooks'
import { EarnExample } from './earn-example'

/**
 * Форма настроек программы.
 *
 * ЧИСЛА ХРАНЯТСЯ СТРОКАМИ, ПОКА ИХ ПЕЧАТАЮТ. Поле «5,5» в процессе набора
 * бывает «5,» — как число это NaN, и форма, хранящая числа, стирала бы запятую
 * под пальцем. В число строка превращается при проверке и при отправке.
 *
 * ПОТОЛОК ЧЕКА ВВОДИТСЯ В БАТАХ, А УХОДИТ В САТАНГАХ. Владелец думает батами,
 * касса считает сатангами (железное правило 4). Перевод — ровно в одном месте,
 * на отправке; тест проверяет, что «3000» уезжает как 300000, а не как 3000.
 */

const toNumber = (value: string): number => Number(value.replace(',', '.').trim())

export function SettingsForm({ initial }: { initial: ProgramSettings }): ReactElement {
  const t = useT()
  const save = useSaveProgramSettings()

  const [earn, setEarn] = useState(String(initial.baseEarnRate))
  const [redeem, setRedeem] = useState(String(initial.baseRedeemRate))
  const [requireReceipt, setRequireReceipt] = useState(initial.cashierRules.requireReceiptNumber)
  const [manualEntry, setManualEntry] = useState(initial.cashierRules.allowManualEntry)
  const [showTags, setShowTags] = useState(initial.cashierRules.showGuestTags)
  const [allowTagging, setAllowTagging] = useState(initial.cashierRules.allowTagging)
  const [cap, setCap] = useState(
    initial.cashierRules.maxManualAmount === null
      ? ''
      : String(initial.cashierRules.maxManualAmount / 100),
  )

  const earnRate = toNumber(earn)
  const redeemRate = toNumber(redeem)
  const capBaht = cap.trim() === '' ? null : toNumber(cap)

  const earnOk = earn.trim() !== '' && Number.isFinite(earnRate) && earnRate >= 0 && earnRate <= 50
  const redeemOk =
    redeem.trim() !== '' && Number.isFinite(redeemRate) && redeemRate >= 0 && redeemRate <= 100
  const capOk = capBaht === null || (Number.isFinite(capBaht) && capBaht > 0)

  const draft: ProgramSettings | null =
    earnOk && redeemOk && capOk
      ? {
          baseEarnRate: earnRate,
          baseRedeemRate: redeemRate,
          cashierRules: {
            requireReceiptNumber: requireReceipt,
            // Баты в сатанги — здесь и больше нигде.
            maxManualAmount: capBaht === null ? null : Math.round(capBaht * 100),
            allowManualEntry: manualEntry,
            showGuestTags: showTags,
            // Вешать теги, не видя их, нельзя: выключенный показ выключает и правку.
            allowTagging: showTags && allowTagging,
          },
        }
      : null

  const reference = save.data ?? initial
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(reference)

  const submit = (event: FormEvent): void => {
    event.preventDefault()

    if (draft === null || !dirty) {
      return
    }

    save.mutate(draft)
  }

  return (
    <form className="settings" onSubmit={submit}>
      <section className="panel" aria-labelledby="settings-points-title">
        <h2 className="panel__title" id="settings-points-title">
          {t('settings.points.title')}
        </h2>

        <div className="panel__grid">
          <div className="field">
            <label className="field__label" htmlFor="settings-earn">
              {t('settings.earn.label')}
            </label>
            <input
              id="settings-earn"
              className="field__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!earnOk}
              aria-describedby={earnOk ? undefined : 'settings-earn-error'}
              value={earn}
              onChange={(event) => {
                setEarn(event.target.value)
              }}
            />
            {earnOk ? null : (
              <span className="field__hint field__hint--error" id="settings-earn-error">
                {t('settings.invalid.earn')}
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="settings-redeem">
              {t('settings.redeem.label')}
            </label>
            <input
              id="settings-redeem"
              className="field__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={!redeemOk}
              aria-describedby={redeemOk ? undefined : 'settings-redeem-error'}
              value={redeem}
              onChange={(event) => {
                setRedeem(event.target.value)
              }}
            />
            {redeemOk ? null : (
              <span className="field__hint field__hint--error" id="settings-redeem-error">
                {t('settings.invalid.redeem')}
              </span>
            )}
          </div>
        </div>

        {earnOk && redeemOk ? <EarnExample earnRate={earnRate} redeemRate={redeemRate} /> : null}
      </section>

      <section className="panel" aria-labelledby="settings-till-title">
        <h2 className="panel__title" id="settings-till-title">
          {t('settings.till.title')}
        </h2>

        <label className="toggle">
          <input
            type="checkbox"
            checked={requireReceipt}
            aria-describedby="settings-receipt-hint"
            onChange={(event) => {
              setRequireReceipt(event.target.checked)
            }}
          />
          <span className="toggle__text">
            <b>{t('settings.receipt.label')}</b>
          </span>
        </label>
        <span className="field__hint toggle__hint" id="settings-receipt-hint">
          {t('settings.receipt.hint')}
        </span>

        <label className="toggle">
          <input
            type="checkbox"
            checked={manualEntry}
            aria-describedby="settings-manual-hint"
            onChange={(event) => {
              setManualEntry(event.target.checked)
            }}
          />
          <span className="toggle__text">
            <b>{t('settings.manual.label')}</b>
          </span>
        </label>
        <span className="field__hint toggle__hint" id="settings-manual-hint">
          {t('settings.manual.hint')}
        </span>

        <label className="toggle">
          <input
            type="checkbox"
            checked={showTags}
            aria-describedby="settings-tags-hint"
            onChange={(event) => {
              setShowTags(event.target.checked)
            }}
          />
          <span className="toggle__text">
            <b>{t('settings.tags.label')}</b>
          </span>
        </label>
        <span className="field__hint toggle__hint" id="settings-tags-hint">
          {t('settings.tags.hint')}
        </span>

        <label className="toggle">
          <input
            type="checkbox"
            checked={showTags && allowTagging}
            disabled={!showTags}
            aria-describedby="settings-tagging-hint"
            onChange={(event) => {
              setAllowTagging(event.target.checked)
            }}
          />
          <span className="toggle__text">
            <b>{t('settings.tagging.label')}</b>
          </span>
        </label>
        <span className="field__hint toggle__hint" id="settings-tagging-hint">
          {t('settings.tagging.hint')}
        </span>

        <div className="field settings__cap">
          <label className="field__label" htmlFor="settings-cap">
            {t('settings.cap.label')}
          </label>
          <input
            id="settings-cap"
            className="field__input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={!capOk}
            aria-describedby="settings-cap-hint"
            value={cap}
            onChange={(event) => {
              setCap(event.target.value)
            }}
          />
          <span
            className={capOk ? 'field__hint' : 'field__hint field__hint--error'}
            id="settings-cap-hint"
          >
            {capOk ? t('settings.cap.hint') : t('settings.invalid.cap')}
          </span>
        </div>
      </section>

      <div className="save-bar">
        {save.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {save.error.message}
          </p>
        ) : save.isSuccess && !dirty ? (
          <p className="save-bar__ok" role="status">
            {t('settings.saved')}
          </p>
        ) : null}
        <button
          className="button button--primary"
          type="submit"
          disabled={draft === null || !dirty || save.isPending}
        >
          {save.isPending ? t('common.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  )
}
